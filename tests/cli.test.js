import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { catalogNumber } from "../dist/core.js";
import { mergeFilterIds, priceRangeLabel } from "../dist/text.js";

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
  for (const name of ["product.yml", "specifications.md", "marketing.md", "raw.json", "images/"]) {
    assert.match(result.stdout, new RegExp(name.replace(".", "\\.")));
  }
  assert.match(result.stdout, /Complete untouched response from KSP's product API/);
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
