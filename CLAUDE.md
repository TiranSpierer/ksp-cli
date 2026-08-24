# CLAUDE.md

KSP MCP server and CLI (ksp.co.il). 4 read-only tools. No auth — requests go through a forged browser TLS/HTTP-2 fingerprint (cycletls) to clear Cloudflare.

## Build & Test

```bash
npm run reload
```

Then call `mcp__ksp-dev__*` tools directly to verify. The dev server is in `.mcp.json`.

## Architecture

ES Modules, TypeScript (ES2022, NodeNext). Output → `dist/`.

- `api/client.ts` — `kspFetch<T>()`, the single fetch choke point. **Cloudflare fingerprints the TLS handshake + HTTP/2 settings (JA3/JA4 + Akamai), not just headers** — so Node's built-in `fetch` gets a 403 challenge no matter what headers it sends. We route every request through **cycletls**, which forges a real Chrome TLS + HTTP/2 fingerprint via a bundled Go helper (spawned lazily on a free port, reused, killed on exit via `closeClient()` + cycletls `autoExit`; the helper is a child process, so it dies with us). The forged fingerprint still gets challenged *probabilistically*, so a **403/Cloudflare-challenge HTML is treated as retryable** (not fail-fast) alongside 429/5xx/495/network errors, with exponential backoff + jitter and **profile rotation** (`PROFILES[]` — matched JA3/UA pairs) across attempts; 404 and other 4xx fail fast. This is the one place backoff/fingerprinting lives, so every call (search, filters, item, all-pages, images) is covered. `fetchBinary(url)` reuses the same fingerprint/backoff for image bytes (`img.ksp.co.il` is behind the same gate). Never call `fetch` directly elsewhere. To widen the fingerprint pool when Cloudflare sours on one, add a *tested* JA3/UA pair to `PROFILES`.
- `api/ksp.ts` — `fetchCategory({query?, filters?, page?})`, `fetchCategoryAllPages()` (loops to `MAX_ALL_PAGES`=50), `getItem()`, and `itemImageUrls()` (largest size per image).
- `types/ksp.ts` — lean interfaces for the fields we read (raw payloads are huge; we don't model all of it), including `KspFilterGroup`/`KspFilterOption`.
- `text.ts` — `htmlToMarkdown()` (turndown; only for HTML fields), `extractUin()` (split-based, no regex), `shekel()`, `priceRangeLabel()` (guards the `{1,1}` placeholder KSP sends on result pages after page 1), `mergeFilterIds()` (split ids on `..`, dedupe, rejoin).
- `schema.ts` — `stringArray()` zod preprocess (accepts array / JSON-string / bare string).
- `tools/` — one file per tool, each exports a `ToolDefinition`. Registered in `tools/index.ts`.
- `server.ts` — `createServer()`; registers tools, shared try/catch → `{ isError: true }`.
- `cli.ts` + `cli-gen.ts` — `ksp-cli`, generated from the same `tools[]` schemas and handlers as MCP.
- `format.ts` — `toYaml()`. All structured responses are YAML for token efficiency.

## Filtering model (get_filters + search_products `filters`)

- KSP filtering = a path of tag ids joined by `..`: `/category/<catId>..<tagId>..<tagId>`. Same facet group = OR, different groups = AND.
- The category response returns the whole facet tree in `result.filter` (groups → options with `action` id + `products_count`), so **no filter is ever hardcoded** — we surface KSP's own facets and shuttle opaque ids back.
- KSP caps each group at 30 options; `group.total` gives the true count, so `get_filters` shows "showing N of M" when truncated.
- Option `action`s share the category prefix (e.g. `3158..137`), so `mergeFilterIds` de-dupes segments and Claude can pass option ids verbatim.

## Conventions

- **No regex / HTML parsing** for data extraction. Read JSON scalars directly. The only HTML (spec bodies, `smalldesc`) goes through `turndown` (maintained lib) → Markdown.
- KSP has **no club/member price** — only regular + Eilat (tax-free). `min_price` is cheapest-variation on multi-config items, not a discount; don't surface it as a price.
- **`data.price` is the list price; the live sale price lives in `bms[uin].discount.value`** (Eilat: `value_eilat`) when a real markdown is active — the payment plan is computed off it, not `data.price`. `get_product` surfaces this as a lean `discount` block (sale price + campaign name) **only when `discount.value` exists**; a `discount` with just a name is a cross-sell campaign, not a price cut, and is skipped (full `bms` — icons, cross-sells, fdi — is available via `include_raw`).
- Responses: YAML via `toYaml()`; plain text for empty/no-result cases.
- `get_product` is lean by default; bloaty data (specs, all variations, branches, images, full delivery, similar) is opt-in via `include_*` flags. `include_raw` is an escape hatch that dumps the entire untouched API payload as JSON and ignores all other flags. `search_products` adds bloaty per-item extras via `include_details`.
- Tool descriptions: one sentence, no examples.

## Making Changes

- New tool: add API wrapper → create `ToolDefinition` → register in `tools/index.ts` → update README + CLAUDE.md.
- After any change: `npm run reload`, test with `mcp__ksp-dev__*`.
