# ksp-mcp

MCP server for [KSP](https://ksp.co.il) — Israel's electronics retailer. Search products and fetch product details straight from KSP's internal JSON API.

## Install

<details>
<summary>Claude Code</summary>

Run in terminal:
```bash
claude mcp add ksp -s user -- npx -y git+https://github.com/tiranspierer/ksp-mcp.git
```

</details>

<details>
<summary>Codex</summary>

Run in terminal:
```bash
codex mcp add ksp npx "-y" "git+https://github.com/tiranspierer/ksp-mcp.git"
```

</details>

<details>
<summary>Antigravity</summary>

Run in terminal:
```bash
agy mcp add ksp -- npx -y git+https://github.com/tiranspierer/ksp-mcp.git
```

</details>

<details>
<summary>Manual MCP config</summary>

```json
{
  "mcpServers": {
    "ksp": {
      "command": "npx",
      "args": ["-y", "git+https://github.com/tiranspierer/ksp-mcp.git"]
    }
  }
}
```

</details>

---

<details>
<summary>CLI</summary>

The package also provides `ksp-cli`, generated from the same tool schemas and handlers as the MCP server:

```bash
npx -y git+https://github.com/TiranSpierer/ksp-mcp.git ksp-cli --help
ksp-cli search-products --query "laptop"
ksp-cli get-product 407256 --include-specs
```

</details>

<details>
<summary>Tools</summary>

- **`search_products`** — search by product name (Hebrew or English), or narrow by filters (brand, size, spec, price, …) to list the products in a category — one page, or every page in a single call. Returns names, prices, stock, and links.
- **`get_filters`** — see the filters available for a search or category (all screen sizes, brands, resolutions, features, …) and how many products match each, so a search can be narrowed precisely.
- **`get_product`** — full details for one product (by id or URL): price, any active sale/discount price, stock, and size/config options; optionally specs, images, branch availability, delivery options, and similar items — or the entire raw payload untouched.
- **`get_product_images`** — download all of a product's photos and get their local file paths, ready to open and view.

</details>

<details>
<summary>How it works</summary>

Talks directly to KSP's internal JSON API — the same one the website uses — so results are fast and structured, with no HTML scraping. Runs locally over stdio; no account, API key, or login required.

</details>

<details>
<summary>Requirements</summary>

- Node.js 20+

</details>

<details>
<summary>Local development</summary>

```bash
npm install   # auto-builds via prepare
npm run reload  # rebuild + restart the dev server
```

The `.mcp.json` at the project root registers a `ksp-dev` server pointing at `dist/index.js`.

</details>
