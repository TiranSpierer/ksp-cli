import TurndownService from "turndown";

// KSP returns some fields (spec bodies, short descriptions) as HTML fragments.
// Rather than hand-roll regex/tag stripping (brittle, needs upkeep when KSP
// changes markup), we convert HTML -> Markdown with a maintained library.
// Markdown is compact and the model reads it natively. Every other field we
// consume is already a clean JSON scalar and never touches this.
const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

turndown.addRule("readableImages", {
  filter: "img",
  replacement: (_content, node) => {
    const image = node as unknown as { getAttribute: (name: string) => string | null };
    const src = image.getAttribute("src")?.trim();
    if (!src) return "";
    return `![Product image](${src})`;
  },
});

function cleanMarkdown(value: string): string {
  return value
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.includes(">") && [...trimmed].every((char) => char === "'" || char === '\"' || char === ">")) return "";
      let end = line.trimEnd();
      while (end.endsWith("'>") || end.endsWith('\">')) end = end.slice(0, -2);
      return end;
    })
    .join("\n")
    .trim();
}

/** Convert an HTML fragment to trimmed Markdown. Empty in -> empty out. */
export function htmlToMarkdown(html: unknown): string {
  if (html === null || html === undefined) return "";
  const s = String(html).trim();
  if (!s) return "";
  // No angle brackets => not HTML, return as-is (avoids needless processing).
  if (!s.includes("<")) return s;
  try {
    return cleanMarkdown(turndown.turndown(s));
  } catch {
    return s;
  }
}

/**
 * Pull a UIN out of either a bare id ("407256") or a KSP URL
 * ("https://ksp.co.il/web/item/407256"). Uses split(), not regex.
 */
export function extractUin(input: string): string {
  let s = String(input).trim();
  s = s.split("?")[0];
  s = s.split("#")[0];
  const parts = s.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}

/** Format a numeric price as ₪N with thousands separators. Falsy/NaN -> null. */
export function shekel(v: unknown): string | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!n || Number.isNaN(n)) return null;
  return `₪${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * "₪min – ₪max" from a min/max pair. Returns null for the {1,1} placeholder KSP
 * sends on result pages after the first (only page 1 carries a real range).
 */
export function priceRangeLabel(min: unknown, max: unknown): string | null {
  const lo = Number(min);
  const hi = Number(max);
  if (!lo || !hi || hi <= 1) return null;
  return lo === hi ? shekel(lo) : `${shekel(lo)} – ${shekel(hi)}`;
}

/**
 * Merge KSP filter ids into a single `..`-joined path. Accepts option ids that
 * already include the category prefix (e.g. "3158..137", "3158..3388"); splits
 * every id on "..", de-dupes segments, and rejoins — so passing option ids
 * verbatim from `search --list-filters` just works and shared prefixes collapse.
 */
export function mergeFilterIds(ids: string[] | undefined): string {
  const seg = new Set<string>();
  for (const id of ids ?? []) {
    for (const part of String(id).split("..")) {
      const s = part.trim();
      if (s) seg.add(s);
    }
  }
  return [...seg].join("..");
}
