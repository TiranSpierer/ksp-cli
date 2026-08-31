# ksp-cli

CLI for searching and inspecting products sold by [KSP Israel](https://ksp.co.il). Search the live catalog, refine results with KSP's current filters, and inspect pricing, availability, specifications, variations, recommendations, and images without an account or API key.

## Install

> [!TIP]
> **Recommended:** Install [`israel-shopping`](https://github.com/TiranSpierer/agent-plugins) from the agent plugin marketplace.

Run directly:

```bash
npx -y -p git+https://github.com/TiranSpierer/ksp-cli.git ksp-cli --help
```

---

<details>
<summary><strong>Search commands</strong></summary>

```bash
ksp-cli search "OLED 65"
ksp-cli search "טלוויזיה" --list-filters
ksp-cli search --filter 3158..134 --filter 3158..3387
ksp-cli search --filter 3158..134 --all-pages
ksp-cli search "laptop" --page 2 --details
```

Search results contain KSP's `list_price`. Use `product offer` or `product info` for the exact active sale price.

`--list-filters` saves the complete live filter tree to `<os-temp>/ksp-cli/searches/<hash>/filters.yml` and prints a compact group index and path. Filter IDs are contextual: apply a category, list filters again, and then choose refinements.

Single-page searches label KSP's aggregate range as `reported_list_price_range`; `--all-pages` computes `list_price_range` from the unique products fetched and reports incomplete pagination honestly.

</details>

<details>
<summary><strong>Product commands</strong></summary>

```bash
ksp-cli product info 403899
ksp-cli product info 403899 --include-images
ksp-cli product offer 403899
ksp-cli product similar 403899
```

- `product info` prints compact identity, effective price, availability, and generated file paths.
- `product offer` prints effective price and availability and saves full commercial details.
- `product similar` prints recommendation counts and saves the complete KSP recommendation lists.
- Product arguments accept either a KSP UIN or full product URL.

</details>

<details>
<summary><strong>Generated files</strong></summary>

`product info` creates a bundle under `<os-temp>/ksp-cli/<uin>/`:

```text
product.yml       Product identity, description, and variations
offer.yml         List/sale/Eilat prices, payments, branch stock, and delivery
specifications.md Structured specifications supplied by KSP
marketing.md      KSP/importer presentation with additional product details
raw.json          Complete untouched response from KSP's product API
images/           Product images, created with --include-images
```

`product similar` additionally creates `recommendations.yml` in the same directory.

</details>

<details>
<summary><strong>Output</strong></summary>

Commands print compact YAML. Product HTML is converted to readable Markdown, and large data is saved to local files so agents can inspect only what they need.

Search/filter counts and ranges retain explicit names such as `reported_count` and `reported_list_price_range` when KSP supplies values that the CLI cannot independently verify.

</details>

<details>
<summary><strong>Requirements</strong></summary>

- Node.js 20+
- No KSP account or API key

</details>
