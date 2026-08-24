import net from "node:net";
import * as cycletls from "cycletls";
import type { CycleTLSClient } from "cycletls";
import { log } from "../log.js";

// cycletls ships as CommonJS (`module.exports = initCycleTLS`); under NodeNext
// the default import can resolve to the module namespace, so normalize it.
type InitCycleTLS = (opts?: {
  port?: number;
  timeout?: number;
  autoExit?: boolean;
}) => Promise<CycleTLSClient>;
const initCycleTLS: InitCycleTLS =
  (cycletls as unknown as { default?: InitCycleTLS }).default ??
  (cycletls as unknown as InitCycleTLS);

const KSP_API = "https://ksp.co.il/m_action/api";
export const KSP_WEB = "https://ksp.co.il/web";

// KSP sits behind Cloudflare, which fingerprints the *TLS handshake + HTTP/2
// settings* (JA3/JA4 + Akamai h2), not just headers. Node's built-in fetch has
// a non-browser handshake, so it gets a 403 Cloudflare challenge no matter what
// headers it sends. cycletls forges a real Chrome TLS + HTTP/2 fingerprint via
// a bundled Go helper — this is why we route every request through it. See
// CLAUDE.md ("Cloudflare / TLS fingerprint") for the full story.
//
// Cloudflare still challenges a forged fingerprint *probabilistically* (a good
// fingerprint passes most of the time, not every time), so a 403/challenge is
// treated as retryable below and we rotate profiles across attempts. This is
// the one place that logic lives, so every call is covered.

// Chrome's HTTP/2 (Akamai) fingerprint — larger window + MASP priority.
const HTTP2_FINGERPRINT = "1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p";

// Coherent Chrome TLS (JA3) + User-Agent bundles. Rotated across retry attempts
// so one soured fingerprint doesn't sink a request. Add more entries to widen
// the pool; each must be a *matched* JA3/UA pair captured from a real browser.
interface Profile {
  ja3: string;
  userAgent: string;
}
const CHROME_JA3 =
  "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513-21,29-23-24,0";
const PROFILES: Profile[] = [
  {
    ja3: CHROME_JA3,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  },
  {
    ja3: CHROME_JA3,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  },
];

const BASE_HEADERS: Record<string, string> = {
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  Referer: `${KSP_WEB}/`,
};

const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 8; // retries after the first attempt (Cloudflare is flaky)
const BASE_DELAY_MS = 400;
const MAX_DELAY_MS = 8_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with jitter; honors a Retry-After hint (seconds). */
function backoffDelay(attempt: number, retryAfterSec?: number): number {
  if (retryAfterSec && retryAfterSec > 0) {
    return Math.min(retryAfterSec * 1000, 30_000);
  }
  const exp = BASE_DELAY_MS * 2 ** attempt;
  return Math.min(exp + Math.random() * BASE_DELAY_MS, MAX_DELAY_MS);
}

// --- cycletls client lifecycle ---------------------------------------------
// Lazily spawned on first use and reused for every subsequent request; the Go
// helper is a *child process*, so it dies with us. `autoExit` registers exit
// handlers as a backstop; closeClient() is the graceful path (CLI calls it
// after its one command, the MCP server on shutdown).

let clientPromise: Promise<CycleTLSClient> | null = null;

/** Grab a free ephemeral port so we never collide with cycletls's default 9119. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function getClient(): Promise<CycleTLSClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const port = await freePort();
      log(`starting cycletls helper on 127.0.0.1:${port}`);
      return initCycleTLS({ port, timeout: TIMEOUT_MS, autoExit: true });
    })();
  }
  return clientPromise;
}

/** Shut down the cycletls helper if it was started. Safe to call unconditionally. */
export async function closeClient(): Promise<void> {
  if (!clientPromise) return;
  const promise = clientPromise;
  clientPromise = null;
  try {
    const client = await promise;
    await client.exit();
  } catch {
    // best-effort; the child dies with the process anyway.
  }
}

/** Is this response/status one we should retry (Cloudflare challenge / transient)? */
function isRetryable(status: number, bodyIsHtml: boolean): boolean {
  if (status === 200 && !bodyIsHtml) return false;
  // 403 = Cloudflare bot challenge (retry with a fresh profile); 495 = cycletls
  // TLS/syscall hiccup; 429/5xx = rate-limit or transient; HTML body on a 200 =
  // a challenge page slipped through.
  return (
    status === 403 ||
    status === 495 ||
    status === 429 ||
    status >= 500 ||
    bodyIsHtml
  );
}

/**
 * GET a KSP m_action API path and parse the JSON. The single fetch choke point
 * for every tool — retry/backoff on Cloudflare challenges and transient
 * failures lives here once and covers all calls (search, filters, item,
 * all-pages, images).
 */
export async function kspFetch<T = unknown>(path: string): Promise<T> {
  const url = `${KSP_API}${path}`;
  const client = await getClient();
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) log(`retry ${attempt}/${MAX_RETRIES} ${path}`);
    else log(`GET ${path}`);

    const profile = PROFILES[attempt % PROFILES.length];

    let status: number;
    let body: string;
    try {
      const res = await client.get(url, {
        ja3: profile.ja3,
        http2Fingerprint: HTTP2_FINGERPRINT,
        userAgent: profile.userAgent,
        headers: { ...BASE_HEADERS, Accept: "application/json" },
        responseType: "text",
      });
      status = res.status;
      body = typeof res.data === "string" ? res.data : String(res.data ?? "");
    } catch (err) {
      // Network / helper-level failure — retryable.
      const msg = err instanceof Error ? err.message : String(err);
      lastErr = new Error(`Failed to reach KSP (${msg}).`);
      if (attempt < MAX_RETRIES) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw lastErr;
    }

    const bodyIsHtml = body.trimStart().startsWith("<");

    // Hard, non-retryable failures.
    if (status === 404) {
      throw new Error(`KSP resource not found (HTTP 404): ${path}`);
    }
    if (status >= 400 && status < 500 && !isRetryable(status, bodyIsHtml)) {
      throw new Error(`KSP API error ${status} for ${path}`);
    }

    if (isRetryable(status, bodyIsHtml)) {
      lastErr = new Error(
        status === 403 || bodyIsHtml
          ? `KSP returned a Cloudflare challenge (HTTP ${status}) for ${path}.`
          : `KSP ${status} (transient) for ${path}.`,
      );
      if (attempt < MAX_RETRIES) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw lastErr;
    }

    // status 200, JSON body.
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error(`KSP returned invalid JSON for ${path}`);
    }
  }

  throw lastErr ?? new Error(`KSP request failed: ${path}`);
}

/**
 * Fetch binary bytes (e.g. a product image) from a full KSP URL. Reuses the
 * same forged fingerprint + backoff — KSP's image CDN (img.ksp.co.il) is behind
 * the same Cloudflare gate, so it needs the browser TLS/HTTP/2 handshake too.
 */
export async function fetchBinary(
  url: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const client = await getClient();
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const profile = PROFILES[attempt % PROFILES.length];

    let res: Awaited<ReturnType<CycleTLSClient["get"]>>;
    try {
      res = await client.get(url, {
        ja3: profile.ja3,
        http2Fingerprint: HTTP2_FINGERPRINT,
        userAgent: profile.userAgent,
        headers: BASE_HEADERS,
        responseType: "arraybuffer",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastErr = new Error(`Failed to fetch ${url} (${msg}).`);
      if (attempt < MAX_RETRIES) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw lastErr;
    }

    if (isRetryable(res.status, false)) {
      lastErr = new Error(`KSP ${res.status} fetching ${url}.`);
      if (attempt < MAX_RETRIES) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw lastErr;
    }

    if (res.status !== 200) {
      throw new Error(`Image fetch failed (HTTP ${res.status}): ${url}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const headers = res.headers ?? {};
    const ctKey = Object.keys(headers).find(
      (k) => k.toLowerCase() === "content-type",
    );
    const contentType = ctKey ? String(headers[ctKey]) : "";
    return { buffer, contentType };
  }

  throw lastErr ?? new Error(`Image fetch failed: ${url}`);
}
