import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = require("okf-search-native");
const prepared = require("okf-search-native/prepared");

assert.deepEqual(Object.keys(root).sort(), [
  "OkfError",
  "createOkfSearch",
  "openOkf",
  "validateOkfDocument",
]);
assert.deepEqual(Object.keys(prepared).sort(), ["NativeOkfSearch"]);

function markdown(type, marker) {
  return `---\ntype: ${type}\n---\n${marker}\n`;
}

const index = root.createOkfSearch([
  { path: "smoke.md", markdown: markdown("note", "friendly-runtime-marker") },
]);
assert.equal(index.search("friendly-runtime-marker")[0]?.documentId, "smoke");
assert.equal(index.ingest({
  path: "nested/added.md",
  markdown: markdown("guide", "friendly-ingest-marker"),
}).conformance, "strict");
assert.deepEqual(index.listTypes(), ["guide", "note"]);
assert.equal(index.remove("./nested//added.md"), true);
assert.throws(
  () => index.autoSuggest("friendly"),
  (error) => error instanceof root.OkfError &&
    error.code === "ERR_OKF_UNSUPPORTED" &&
    error.path === "autoSuggest",
);

const native = prepared.NativeOkfSearch.fromPrepared([]);
assert.deepEqual(native.listTypes(), []);

console.log("native root and prepared runtime smoke passed");
