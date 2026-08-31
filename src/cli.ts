#!/usr/bin/env node
import { Command } from "commander";
import { closeClient } from "./api/client.js";
import { productOffer, saveProductInfo, searchProducts, similarProducts } from "./core.js";
import { toYaml } from "./format.js";

function positive(value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error("value must be a positive integer");
  return number;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat(value);
}

async function output(work: Promise<unknown>): Promise<void> {
  process.stdout.write(toYaml(await work));
}

export function buildProgram(): Command {
  const program = new Command()
    .name("ksp-cli")
    .description("Search and inspect products sold by KSP Israel.")
    .version("1.0.0")
    .showHelpAfterError();

  program.command("search")
    .description("Search KSP's product catalog by text, live filter IDs, or both.")
    .argument("[query]", "product search text in Hebrew or English")
    .option("--filter <id>", "apply a contextual filter ID returned by --list-filters; repeatable", collect, [])
    .option("--page <number>", "result page", positive, 1)
    .option("--all-pages", "fetch every result page, up to 50 pages")
    .option("--details", "include descriptions and thumbnails")
    .option("--list-filters", "list the currently available filter groups and IDs instead of products")
    .addHelpText("after", "\nSearch results contain KSP list prices. Use product offer for an exact active sale price.\nFilter IDs are contextual. After applying a category filter, run --list-filters again before choosing further refinements.\n")
    .action((query: string | undefined, options) => output(searchProducts({
      query, filters: options.filter, page: options.page, allPages: Boolean(options.allPages),
      details: Boolean(options.details), listFilters: Boolean(options.listFilters),
    })));

  const product = program.command("product").description("Inspect a specific KSP product.");
  product.command("info")
    .description("Save detailed product information and specifications.")
    .argument("<product>", "product UIN or KSP URL")
    .option("--include-images", "download all product images")
    .addHelpText("after", "\nCreates these files under the OS temporary directory:\n\n  product.yml       Product identity, description, and variations\n  offer.yml         KSP prices, payments, branch stock, and delivery\n  specifications.md Structured specifications supplied by KSP\n  marketing.md      KSP/importer presentation with additional product details\n  raw.json          Complete untouched response from KSP's product API\n  images/           Product images; created only with --include-images\n")
    .action((value: string, options) => output(saveProductInfo(value, Boolean(options.includeImages))));

  product.command("offer")
    .description("Show KSP's effective price and availability and save full offer details.")
    .argument("<product>", "product UIN or KSP URL")
    .addHelpText("after", "\nSaves list, sale and Eilat prices, payments, branch stock, and delivery to offer.yml under the OS temporary directory.\n")
    .action((value: string) => output(productOffer(value)));

  product.command("similar")
    .description("Show similar and complementary products suggested by KSP.")
    .argument("<product>", "product UIN or KSP URL")
    .action((value: string) => output(similarProducts(value)));
  return program;
}

export async function main(argv = process.argv): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    await closeClient();
  }
}

void main();
