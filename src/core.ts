import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fetchBinary, KSP_WEB } from "./api/client.js";
import { fetchCategory, fetchCategoryAllPages, getItem, getItemRaw, itemImageUrls, MAX_ALL_PAGES } from "./api/ksp.js";
import { atomicWrite, productDirectory, searchDirectory } from "./files.js";
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

interface FilterGroupOutput {
  group?: string;
  showing?: string;
  options: Array<{ name?: string; id?: string; reported_count?: number }>;
}

async function filtersOutput(result: Awaited<ReturnType<typeof fetchCategory>>, query?: string, applied?: string): Promise<unknown> {
  const groups = Object.values(result.filter ?? {}).flatMap((group) => {
    const options = Object.values(group.tags ?? {}).filter((option) => option.action).map((option) => ({
      name: htmlToMarkdown(option.name), id: option.action, reported_count: option.products_count,
    }));
    if (!options.length) return [];
    const value: FilterGroupOutput = { group: htmlToMarkdown(group.catName), options };
    const total = group.total ?? options.length;
    if (total > options.length) value.showing = `${options.length} of ${total} (top by relevance)`;
    return [value];
  });
  const full = { total: result.products_total, ...(applied ? { applied_filters: applied } : {}), filter_groups: groups };
  const path = join(searchDirectory(JSON.stringify([query ?? "", applied ?? ""])), "filters.yml");
  await atomicWrite(path, toYaml(full));
  return {
    total: result.products_total,
    ...(applied ? { applied_filters: applied } : {}),
    filter_groups: groups.map((group) => ({
      group: group.group,
      options: group.options.length,
      ...(group.showing ? { showing: group.showing } : {}),
    })),
    file: path,
  };
}

function productCard(item: KspSearchItem, details = false): unknown {
  const value: Record<string, unknown> = { uin: item.uin, name: htmlToMarkdown(item.name), list_price: shekel(item.price) };
  const eilat = item.eilatPrice || item.min_eilat_price;
  if (eilat) value.eilat_price = shekel(eilat);
  if (item.brandName) value.brand = item.brandName;
  value.in_stock = Boolean(item.addToCart) && !item.outOfStock;
  const labels = (item.labels ?? []).flatMap((label) => label?.msg ? [label.msg] : []);
  if (labels.length) value.labels = labels;
  if (details) {
    if (item.description) value.description = htmlToMarkdown(item.description);
    if (item.img) value.thumbnail = item.img;
  }
  value.url = `${KSP_WEB}/item/${item.uin}`;
  return value;
}

export function uniqueSearchItems(items: KspSearchItem[]): KspSearchItem[] {
  const unique = new Map<string, KspSearchItem>();
  for (const item of items) {
    const key = String(item.uin);
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

export async function searchProducts(input: SearchInput): Promise<unknown> {
  const filters = requireSearch(input);
  if (input.listFilters) {
    return filtersOutput(await fetchCategory({ query: input.query, filters: filters || undefined }), input.query, filters || undefined);
  }
  if (input.allPages) {
    const result = await fetchCategoryAllPages({ query: input.query, filters: filters || undefined });
    const items = uniqueSearchItems(result.items);
    const duplicateCount = result.items.length - items.length;
    const total = Number(result.total);
    const incomplete = result.capped || (Number.isFinite(total) && items.length < total);
    const prices = items.map((item) => Number(item.price)).filter((price) => price > 0);
    return {
      total: result.total ?? 0,
      ...(filters ? { applied_filters: filters } : {}),
      ...(prices.length ? { list_price_range: priceRangeLabel(Math.min(...prices), Math.max(...prices)) } : {}),
      fetched: items.length,
      ...(duplicateCount ? { duplicates_removed: duplicateCount } : {}),
      ...(incomplete ? { complete: false } : {}),
      ...(result.capped ? { note: `Stopped at ${MAX_ALL_PAGES} pages; narrow the search to fetch the remaining products.` } : {}),
      products: items.map((item) => productCard(item, input.details)),
    };
  }
  const result = await fetchCategory({ query: input.query, filters: filters || undefined, page: input.page ?? 1 });
  const range = priceRangeLabel(result.minMax?.min, result.minMax?.max);
  return {
    total: result.products_total ?? 0,
    ...(filters ? { applied_filters: filters } : {}),
    ...(range ? { reported_list_price_range: range } : {}),
    ...(result.next ? { next_page: result.next } : {}),
    products: uniqueSearchItems(result.items ?? []).map((item) => productCard(item, input.details)),
  };
}

export function variationData(item: KspItemResult): unknown[] {
  const names = Object.fromEntries(Object.values(item.products_options?.render?.tags ?? {}).flatMap((axis) =>
    (axis.items ?? []).map((option) => [String(option.id), option.name]),
  ));
  const result = (item.products_options?.variations ?? []).map((variation) => ({
    label: Object.values(variation.tags ?? {}).map((id) => names[String(id)] ?? String(id)).join(", "),
    uin: variation.data?.uin_item,
    list_price: shekel(variation.data?.price),
  }));
  const currentUin = String(item.data?.uin ?? "");
  if (result.length === 1 && !result[0].label && String(result[0].uin ?? "") === currentUin) return [];
  return result;
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
  const rawModel = htmlToMarkdown(item.specification?.modalName).trim();
  const model = rawModel && rawModel !== "-" ? rawModel : undefined;
  const catalog = catalogNumber(item);
  const identity = {
    uin,
    name: htmlToMarkdown(data.name),
    ...(data.brandName ? { brand: data.brandName } : {}),
    ...(model ? { model } : {}),
    ...(catalog ? { catalog_number: catalog } : {}),
  };
  const directory = productDirectory(uin);
  const sections = item.specification?.items ?? [];
  const productVariations = variationData(item);
  const offer = offerData(item, uin);
  const isMarketing = (section: { head?: string }) => htmlToMarkdown(section.head).trim() === "סקירה";
  const paths = {
    product: join(directory, "product.yml"),
    offer: join(directory, "offer.yml"),
    specifications: join(directory, "specifications.md"),
    marketing: join(directory, "marketing.md"),
    raw: join(directory, "raw.json"),
  };
  await Promise.all([
    atomicWrite(paths.product, toYaml({
      ...identity,
      description: data.smalldesc ? htmlToMarkdown(data.smalldesc) : undefined,
      ...(productVariations.length ? { variations: productVariations } : {}), url: `${KSP_WEB}/item/${uin}`,
    })),
    atomicWrite(paths.offer, toYaml(offer)),
    atomicWrite(paths.specifications, markdown(`${htmlToMarkdown(data.name) || uin} — specifications`, sections.filter((section) => !isMarketing(section)))),
    atomicWrite(paths.marketing, markdown(`${htmlToMarkdown(data.name) || uin} — marketing`, sections.filter(isMarketing))),
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
    price: offer.price, in_stock: offer.in_stock, files,
    ...(imageResult ? { images_downloaded: imageResult.count, ...(imageResult.failed ? { images_failed: imageResult.failed } : {}) } : {}),
  };
}

interface DiscountData {
  uin: string;
  price: string | null;
  value: number;
  eilat_price?: string | null;
  about?: string;
}

function activeDiscounts(item: KspItemResult): DiscountData[] {
  return Object.entries(item.bms ?? {}).flatMap(([uin, entry]) => {
    const discount = entry && typeof entry === "object" ? (entry as Record<string, unknown>).discount : undefined;
    if (!discount || typeof discount !== "object") return [];
    const value = discount as Record<string, unknown>;
    if (value.value == null) return [];
    return [{ uin, price: shekel(value.value), value: Number(value.value), ...(value.value_eilat != null ? { eilat_price: shekel(value.value_eilat) } : {}), ...(typeof value.name === "string" ? { about: value.name } : {}) }];
  });
}

function paymentData(item: KspItemResult, discount?: DiscountData): unknown {
  const count = Number(item.payments?.max_wo);
  const perPayment = Number(item.payments?.perPayment);
  if (!Number.isFinite(count) || count < 1) return undefined;
  if (!Number.isFinite(perPayment) || perPayment <= 0) return { max_without_interest: item.payments?.max_wo };
  const total = count * perPayment;
  const listPrice = Number(item.data?.price);
  const closeTo = (price: number) => Number.isFinite(price) && Math.abs(total - price) <= count;
  const priceBasis = discount && closeTo(discount.value)
    ? "effective_price"
    : closeTo(listPrice) ? "list_price" : "unknown";
  return {
    max_without_interest: item.payments?.max_wo,
    per_payment: shekel(perPayment),
    price_basis: priceBasis,
  };
}

export function offerData(item: KspItemResult, requestedUin: string): Record<string, unknown> & { price: string | null; in_stock: boolean } {
  const data = item.data ?? {};
  const uin = String(data.uin ?? requestedUin);
  const stock = Array.isArray(item.stock) ? item.stock : item.stock && typeof item.stock === "object" ? Object.values(item.stock) : [];
  const discounts = activeDiscounts(item);
  const discount = discounts.find((entry) => entry.uin === uin) ?? (discounts.length === 1 ? discounts[0] : undefined);
  const payments = paymentData(item, discount);
  const branches = stock.flatMap((branch) => branch?.name || branch?.title ? [branch.name ?? branch.title] : []);
  const delivery = (item.delivery ?? []).map((entry) => ({
    option: htmlToMarkdown(entry.title) || entry.type, price: shekel(entry.price) ?? "₪0",
    ...(entry.time ? { eta_days: `${entry.time.min}–${entry.time.max}` } : {}),
  }));
  return {
    uin,
    name: htmlToMarkdown(data.name),
    price: discount?.price ?? shekel(data.price),
    ...(discount ? { list_price: shekel(data.price), discount_about: discount.about } : {}),
    ...(discount?.eilat_price ? {
      eilat_price: discount.eilat_price,
      ...(data.eilatPrice ? { list_eilat_price: shekel(data.eilatPrice) } : {}),
    } : data.eilatPrice ? { eilat_price: shekel(data.eilatPrice) } : {}),
    in_stock: Boolean(data.addToCart),
    branches,
    ...(payments ? { payments } : {}),
    delivery,
    url: `${KSP_WEB}/item/${uin}`,
  };
}

function offerSummary(offer: Record<string, unknown> & { price: string | null; in_stock: boolean }, path: string): unknown {
  const branches = Array.isArray(offer.branches) ? offer.branches : [];
  return {
    uin: offer.uin,
    name: offer.name,
    price: offer.price,
    in_stock: offer.in_stock,
    ...(branches.length ? { available_branches: branches.length } : {}),
    file: path,
  };
}

export async function productOffer(product: string): Promise<unknown> {
  const requestedUin = extractUin(product);
  const item = await getItem(requestedUin);
  const uin = String(item.data?.uin ?? requestedUin);
  const offer = offerData(item, uin);
  const path = join(productDirectory(uin), "offer.yml");
  await atomicWrite(path, toYaml(offer));
  return offerSummary(offer, path);
}

function relatedProduct(product: unknown): unknown {
  if (!product || typeof product !== "object") return product;
  const value = product as Record<string, unknown>;
  return { uin: value.uin, name: htmlToMarkdown(value.name), list_price: shekel(value.price ?? value.min_price), ...(value.uin ? { url: `${KSP_WEB}/item/${value.uin}` } : {}) };
}

export async function similarProducts(product: string): Promise<unknown> {
  const requestedUin = extractUin(product);
  const item = await getItem(requestedUin);
  const data = item.data ?? {};
  const similar = Array.isArray(item.similarItem) ? item.similarItem : item.similarItem ? [item.similarItem] : [];
  const complementary = Array.isArray(item.complementary_products) ? item.complementary_products : [];
  const recommendations = {
    uin: String(data.uin ?? requestedUin), name: htmlToMarkdown(data.name),
    similar: similar.map(relatedProduct), complementary: complementary.map(relatedProduct),
  };
  const path = join(productDirectory(String(data.uin ?? requestedUin)), "recommendations.yml");
  await atomicWrite(path, toYaml(recommendations));
  return {
    uin: recommendations.uin,
    name: recommendations.name,
    similar: recommendations.similar.length,
    complementary: recommendations.complementary.length,
    file: path,
  };
}
