import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fetchBinary, KSP_WEB } from "./api/client.js";
import { fetchCategory, fetchCategoryAllPages, getItem, getItemRaw, itemImageUrls, MAX_ALL_PAGES } from "./api/ksp.js";
import { atomicWrite, productDirectory } from "./files.js";
import { toYaml } from "./format.js";
import { extractUin, htmlToMarkdown, mergeFilterIds, priceRangeLabel, shekel } from "./text.js";
import type { KspItemResult, KspSearchItem } from "./types/ksp.js";

export interface SearchInput {
  query?: string;
  filters?: string[];
  page?: number;
  allPages?: boolean;
  details?: boolean;
  listFilters?: boolean;
}

function requireSearch(input: SearchInput): string {
  const filters = mergeFilterIds(input.filters);
  if (!filters && !input.query?.trim()) throw new Error("provide a query or at least one --filter");
  return filters;
}

function filtersOutput(result: Awaited<ReturnType<typeof fetchCategory>>, applied?: string): unknown {
  const groups = Object.values(result.filter ?? {}).flatMap((group) => {
    const options = Object.values(group.tags ?? {}).filter((option) => option.action).map((option) => ({
      name: option.name, id: option.action, count: option.products_count,
    }));
    if (!options.length) return [];
    const value: Record<string, unknown> = { group: group.catName };
    const total = group.total ?? options.length;
    if (total > options.length) value.showing = `${options.length} of ${total} (top by relevance)`;
    value.options = options;
    return [value];
  });
  return { total: result.products_total, ...(applied ? { applied_filters: applied } : {}), filter_groups: groups };
}

function productCard(item: KspSearchItem, details = false): unknown {
  const value: Record<string, unknown> = { uin: item.uin, name: item.name, price: shekel(item.price) };
  const eilat = item.eilatPrice || item.min_eilat_price;
  if (eilat) value.eilat_price = shekel(eilat);
  if (item.brandName) value.brand = item.brandName;
  value.in_stock = Boolean(item.addToCart) && !item.outOfStock;
  const labels = (item.labels ?? []).flatMap((label) => label?.msg ? [label.msg] : []);
  if (labels.length) value.labels = labels;
  if (details) {
    if (item.description) value.description = item.description;
    if (item.img) value.thumbnail = item.img;
    if (item.payments?.max_num_payments_wo_interest) {
      value.payments = `up to ${item.payments.max_num_payments_wo_interest} interest-free${item.payments.estimated_payment ? ` (₪${item.payments.estimated_payment}/mo)` : ""}`;
    }
  }
  value.url = `${KSP_WEB}/item/${item.uin}`;
  return value;
}

export async function searchProducts(input: SearchInput): Promise<unknown> {
  const filters = requireSearch(input);
  if (input.listFilters) {
    return filtersOutput(await fetchCategory({ query: input.query, filters: filters || undefined }), filters || undefined);
  }
  if (input.allPages) {
    const result = await fetchCategoryAllPages({ query: input.query, filters: filters || undefined });
    const prices = result.items.map((item) => Number(item.price)).filter((price) => price > 0);
    return {
      total: result.total ?? 0,
      ...(filters ? { applied_filters: filters } : {}),
      ...(prices.length ? { price_range: priceRangeLabel(Math.min(...prices), Math.max(...prices)) } : {}),
      fetched: result.items.length,
      ...(result.capped ? { note: `Stopped at ${MAX_ALL_PAGES} pages; narrow the search to fetch the remaining products.` } : {}),
      products: result.items.map((item) => productCard(item, input.details)),
    };
  }
  const result = await fetchCategory({ query: input.query, filters: filters || undefined, page: input.page ?? 1 });
  const range = priceRangeLabel(result.minMax?.min, result.minMax?.max);
  return {
    total: result.products_total ?? 0,
    ...(filters ? { applied_filters: filters } : {}),
    ...(range ? { price_range: range } : {}),
    ...(result.next ? { next_page: result.next } : {}),
    products: (result.items ?? []).map((item) => productCard(item, input.details)),
  };
}

function variations(item: KspItemResult): unknown[] {
  const names = Object.fromEntries(Object.values(item.products_options?.render?.tags ?? {}).flatMap((axis) =>
    (axis.items ?? []).map((option) => [String(option.id), option.name]),
  ));
  return (item.products_options?.variations ?? []).map((variation) => ({
    label: Object.values(variation.tags ?? {}).map((id) => names[String(id)] ?? String(id)).join(", "),
    uin: variation.data?.uin_item,
    price: shekel(variation.data?.price),
  }));
}

function markdown(title: string, sections: Array<{ head?: string; body?: string }>): string {
  const body = sections.flatMap((section) => {
    const heading = htmlToMarkdown(section.head).trim();
    const content = htmlToMarkdown(section.body).trim();
    return heading && content ? [`## ${heading}\n\n${content}`] : [];
  }).join("\n\n");
  return `# ${title}\n\n${body}\n`;
}

function resultFromRaw(raw: unknown): KspItemResult {
  if (!raw || typeof raw !== "object") throw new Error("KSP returned an invalid product response");
  return (raw as { result?: KspItemResult }).result ?? {};
}

const CATALOG_NUMBER_HEADINGS = new Set(["מק''ט", "מק'ט", 'מק"ט', "מק״ט"]);

export function catalogNumber(item: KspItemResult): string | undefined {
  const section = (item.specification?.items ?? []).find((candidate) =>
    CATALOG_NUMBER_HEADINGS.has(htmlToMarkdown(candidate.head).trim()),
  );
  return section ? htmlToMarkdown(section.body).trim() || undefined : undefined;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/avif": ".avif", "image/gif": ".gif",
};

async function downloadImages(uin: string, item: KspItemResult, directory: string) {
  const imagesDirectory = join(directory, "images");
  await mkdir(imagesDirectory, { recursive: true });
  const results = await Promise.all(itemImageUrls(item).map(async (url, index) => {
    try {
      const response = await fetchBinary(url);
      await atomicWrite(join(imagesDirectory, `${uin}_${index + 1}${IMAGE_EXTENSIONS[response.contentType] ?? ".jpg"}`), response.buffer);
      return true;
    } catch {
      return false;
    }
  }));
  return { directory: imagesDirectory, count: results.filter(Boolean).length, failed: results.filter((ok) => !ok).length };
}

export async function saveProductInfo(product: string, includeImages = false): Promise<unknown> {
  const requestedUin = extractUin(product);
  const raw = await getItemRaw(requestedUin);
  const item = resultFromRaw(raw);
  const data = item.data ?? {};
  const uin = String(data.uin ?? requestedUin);
  const model = item.specification?.modalName || undefined;
  const catalog = catalogNumber(item);
  const identity = {
    uin,
    name: data.name,
    ...(data.brandName ? { brand: data.brandName } : {}),
    ...(model ? { model } : {}),
    ...(catalog ? { catalog_number: catalog } : {}),
  };
  const directory = productDirectory(uin);
  const sections = item.specification?.items ?? [];
  const isMarketing = (section: { head?: string }) => htmlToMarkdown(section.head).trim() === "סקירה";
  const paths = {
    product: join(directory, "product.yml"),
    specifications: join(directory, "specifications.md"),
    marketing: join(directory, "marketing.md"),
    raw: join(directory, "raw.json"),
  };
  await Promise.all([
    atomicWrite(paths.product, toYaml({
      ...identity,
      description: data.smalldesc ? htmlToMarkdown(data.smalldesc) : undefined,
      variations: variations(item), url: `${KSP_WEB}/item/${uin}`,
    })),
    atomicWrite(paths.specifications, markdown(`${data.name ?? uin} — specifications`, sections.filter((section) => !isMarketing(section)))),
    atomicWrite(paths.marketing, markdown(`${data.name ?? uin} — marketing`, sections.filter(isMarketing))),
    atomicWrite(paths.raw, `${JSON.stringify(raw, null, 2)}\n`),
  ]);
  let imageResult: Awaited<ReturnType<typeof downloadImages>> | undefined;
  const files: Record<string, string> = { ...paths };
  if (includeImages) {
    imageResult = await downloadImages(uin, item, directory);
    files.images = imageResult.directory;
  }
  return {
    ...identity,
    price: shekel(data.price), in_stock: Boolean(data.addToCart), files,
    ...(imageResult ? { images_downloaded: imageResult.count, ...(imageResult.failed ? { images_failed: imageResult.failed } : {}) } : {}),
  };
}

function activeDiscounts(item: KspItemResult): unknown[] {
  return Object.entries(item.bms ?? {}).flatMap(([uin, entry]) => {
    const discount = entry && typeof entry === "object" ? (entry as Record<string, unknown>).discount : undefined;
    if (!discount || typeof discount !== "object") return [];
    const value = discount as Record<string, unknown>;
    if (value.value == null) return [];
    return [{ uin, price: shekel(value.value), ...(value.value_eilat != null ? { eilat_price: shekel(value.value_eilat) } : {}), ...(typeof value.name === "string" ? { about: value.name } : {}) }];
  });
}

export async function productOffer(product: string): Promise<unknown> {
  const requestedUin = extractUin(product);
  const item = await getItem(requestedUin);
  const data = item.data ?? {};
  const uin = String(data.uin ?? requestedUin);
  const stock = Array.isArray(item.stock) ? item.stock : item.stock && typeof item.stock === "object" ? Object.values(item.stock) : [];
  const output: Record<string, unknown> = {
    uin, name: data.name, price: shekel(data.price),
    ...(data.eilatPrice ? { eilat_price: shekel(data.eilatPrice) } : {}), in_stock: Boolean(data.addToCart),
  };
  const discounts = activeDiscounts(item);
  if (discounts.length) output.discount = discounts.length === 1 ? discounts[0] : discounts;
  const branches = stock.flatMap((branch) => branch?.name || branch?.title ? [branch.name ?? branch.title] : []);
  if (branches.length) output.branches = branches;
  if (item.payments?.max_wo) output.payments = `up to ${item.payments.max_wo} interest-free${item.payments.perPayment ? ` (₪${item.payments.perPayment}/mo)` : ""}`;
  if (item.delivery?.length) output.delivery = item.delivery.map((delivery) => ({
    option: htmlToMarkdown(delivery.title) || delivery.type, price: shekel(delivery.price) ?? "₪0",
    ...(delivery.time ? { eta_days: `${delivery.time.min}–${delivery.time.max}` } : {}),
  }));
  output.url = `${KSP_WEB}/item/${uin}`;
  return output;
}

function relatedProduct(product: unknown): unknown {
  if (!product || typeof product !== "object") return product;
  const value = product as Record<string, unknown>;
  return { uin: value.uin, name: value.name, price: shekel(value.price ?? value.min_price), ...(value.uin ? { url: `${KSP_WEB}/item/${value.uin}` } : {}) };
}

export async function similarProducts(product: string): Promise<unknown> {
  const requestedUin = extractUin(product);
  const item = await getItem(requestedUin);
  const data = item.data ?? {};
  const similar = Array.isArray(item.similarItem) ? item.similarItem : item.similarItem ? [item.similarItem] : [];
  const complementary = Array.isArray(item.complementary_products) ? item.complementary_products : [];
  return {
    uin: String(data.uin ?? requestedUin), name: data.name,
    similar: similar.map(relatedProduct), complementary: complementary.map(relatedProduct),
  };
}
