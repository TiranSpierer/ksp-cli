# ksp-cli

CLI for searching and inspecting products sold by [KSP Israel](https://ksp.co.il). It reads KSP's live catalog, pricing, availability, variations, specifications, recommendations, and images without an account or API key.

## Install

Recommended: install [`israel-shopping`](https://github.com/TiranSpierer/agent-plugins) from the agent plugin marketplace.

Run directly:

```bash
npx -y git+https://github.com/TiranSpierer/ksp-cli.git ksp-cli --help
```

## Commands

```bash
ksp-cli search "OLED 65"
ksp-cli search "טלוויזיה" --list-filters
ksp-cli search --filter 3158..134 --filter 3158..3387 --all-pages

ksp-cli product info 403899
ksp-cli product info 403899 --include-images
ksp-cli product offer 403899
ksp-cli product similar 403899
```

`search --list-filters` returns KSP's current filter groups and opaque option IDs. Pass selected IDs back with repeatable `--filter` options. Filter IDs are contextual: apply a category, list filters again, and then choose refinements. IDs are never hardcoded by the CLI.

`product info` creates a product bundle under `<os-temp>/ksp-cli/<uin>/`:

```text
product.yml       Product identity, description, and variations
offer.yml         KSP prices, payments, branch stock, and delivery
specifications.md Structured specifications supplied by KSP
marketing.md      KSP/importer presentation with additional product details
raw.json          Complete untouched response from KSP's product API
images/           Product images, with --include-images
```

Commands print compact YAML. Product specifications and marketing HTML are converted to Markdown.

## Requirements

- Node.js 20+

## Local development

```bash
npm install
npm test
node dist/cli.js --help
```
