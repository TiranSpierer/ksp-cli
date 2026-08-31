# CLAUDE.md

TypeScript CLI for searching and inspecting products sold by KSP Israel. No authentication is required.

## Commands

```bash
npm install
npm test
node dist/cli.js --help
```

## Architecture

- `api/client.ts` is the single network boundary. KSP's Cloudflare protection requires CycleTLS browser fingerprinting. Requests rotate complete matched JA3, HTTP/2, and User-Agent profiles and retry challenges and transient failures.
- `api/ksp.ts` contains lean wrappers for KSP's category and item API endpoints.
- `core.ts` contains framework-neutral search, product bundle, offer, and recommendation operations.
- `cli.ts` explicitly defines the command hierarchy and serializes core results.
- `files.ts` writes product bundle files atomically under the OS temporary directory.
- `text.ts` normalizes identifiers, filter paths, prices, and HTML-to-Markdown conversion.
- `types/ksp.ts` models only fields consumed by the CLI.

The core returns structured JavaScript values and throws errors. Commander and terminal output belong only in `cli.ts`.

## KSP behavior

- Filter IDs come from the live category response. Never hardcode them.
- Filter IDs share category prefixes; `mergeFilterIds()` de-duplicates their `..` path segments.
- `data.price` is list price. A live sale price exists only when `bms[uin].discount.value` is present.
- `min_price` is the cheapest variation, not a discount.
- KSP has regular and Eilat prices, not club prices.
- Product HTML is converted with Turndown; do not hand-parse HTML.
- Route API and image requests through `api/client.ts`; plain Node fetch is blocked by Cloudflare.

## Changes

- Keep CLI parsing and formatting outside the core.
- Update README for user-visible changes.
- Run `npm test` and representative live commands.
