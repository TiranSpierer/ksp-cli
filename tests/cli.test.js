import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { catalogNumber, offerData, uniqueSearchItems, variationData } from "../dist/core.js";
import { htmlToMarkdown, mergeFilterIds, priceRangeLabel } from "../dist/text.js";

function cli(...args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8" });
}

test("top-level help exposes the CLI resource model", () => {
  const result = cli("--help");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /search \[options\] \[query\]/);
  assert.match(result.stdout, /product\s+Inspect a specific KSP product/);
  assert.doesNotMatch(result.stdout, /get-product|MCP/);
});

test("product info help documents every generated file", () => {
  const result = cli("product", "info", "--help");
  assert.equal(result.status, 0);
  for (const name of ["product.yml", "offer.yml", "specifications.md", "marketing.md", "raw.json", "images/"]) {
    assert.match(result.stdout, new RegExp(name.replace(".", "\\.")));
  }
  assert.match(result.stdout, /Complete untouched response from KSP's product API/);
});

test("all-pages products are deduplicated by UIN", () => {
  assert.deepEqual(uniqueSearchItems([{ uin: 1 }, { uin: "1" }, { uin: 2 }]), [{ uin: 1 }, { uin: 2 }]);
});

test("a meaningless default variation is omitted", () => {
  assert.deepEqual(variationData({
    data: { uin: 277841 },
    products_options: { variations: [{ data: { uin_item: 277841, price: 167 }, tags: {} }] },
  }), []);
});

test("offer data prefers a real discount and preserves commercial details", () => {
  const offer = offerData({
    data: { uin: 277841, name: "Camera", price: 167, eilatPrice: 142, addToCart: true },
    bms: { "277841": { discount: { value: 139, value_eilat: 118, name: "Sale" } } },
    stock: [{ name: "Branch" }],
    payments: { max_wo: 1, perPayment: 139 },
    delivery: [{ title: "Delivery", price: 30, time: { min: 1, max: 7 } }],
  }, "277841");
  assert.equal(offer.price, "₪139");
  assert.equal(offer.list_price, "₪167");
  assert.equal(offer.eilat_price, "₪118");
  assert.deepEqual(offer.branches, ["Branch"]);
  assert.deepEqual(offer.payments, { max_without_interest: 1, per_payment: "₪139", price_basis: "effective_price" });
});

test("payment data labels installments based on list price", () => {
  const offer = offerData({
    data: { uin: 403291, price: 399, addToCart: true },
    bms: { "403291": { discount: { value: 339 } } },
    payments: { max_wo: 1, perPayment: 399 },
  }, "403291");
  assert.deepEqual(offer.payments, { max_without_interest: 1, per_payment: "₪399", price_basis: "list_price" });
  assert.equal(Object.hasOwn(offer, "list_eilat_price"), false);
});

test("payment data preserves an unknown upstream price basis", () => {
  const offer = offerData({
    data: { uin: 300112, price: 1599, eilatPrice: 1355, addToCart: true },
    payments: { max_wo: 4, perPayment: 312 },
  }, "300112");
  assert.equal(offer.price, "₪1,599");
  assert.equal(offer.eilat_price, "₪1,355");
  assert.deepEqual(offer.payments, { max_without_interest: 4, per_payment: "₪312", price_basis: "unknown" });
});

test("HTML conversion removes known debris and bounds noisy image alt text", () => {
  assert.equal(htmlToMarkdown("<br>Useful description"), "Useful description");
  assert.equal(htmlToMarkdown("<p>Useful.'></p>"), "Useful.");
  assert.equal(htmlToMarkdown("31 אינץ&apos;"), "31 אינץ'");
  assert.equal(htmlToMarkdown("Fan< / red> - silver"), "Fan - silver");
  const noisy = "x".repeat(121);
  assert.equal(htmlToMarkdown(`<img src="https://example.com/a.jpg" alt="${noisy}">`), "![Product image](https://example.com/a.jpg)");
  assert.equal(htmlToMarkdown("<div>'>'></div>"), "");
});

test("filter paths merge repeated prefixed IDs", () => {
  assert.equal(mergeFilterIds(["3158..134", "3158..3387", "3158..5707"]), "3158..134..3387..5707");
});

test("placeholder price ranges are omitted", () => {
  assert.equal(priceRangeLabel(1, 1), null);
  assert.equal(priceRangeLabel(5269, 5269), "₪5,269");
});

test("catalog number is read without treating it as a model field", () => {
  const item = {
    specification: {
      modalName: null,
      items: [{ head: "מק''ט", body: "<p>MS23K3555EK </p>" }],
    },
  };
  assert.equal(catalogNumber(item), "MS23K3555EK");
  assert.equal(item.specification.modalName, null);
});
