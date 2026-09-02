import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const api = require("../index.js");

assert.deepEqual(
  Object.keys(api).sort(),
  ["NativeOkfSearch"],
  "the native package should expose only NativeOkfSearch at runtime",
);

function section(documentId, marker, conformance = "strict") {
  return {
    sectionId: `${documentId}#root`,
    documentId,
    conformance,
    title: `Native ${marker}`,
    path: `${documentId}.md`,
    type: "note",
    tags: ["native"],
    status: "stable",
    staleAfterEpoch: undefined,
    stalenessClassified: true,
    trustTier: "human-reviewed",
    resource: documentId,
    headingPath: "Overview",
    description: "Prepared native runtime smoke fixture",
    sourceText: marker,
    text: marker,
    startLine: 1,
    endLine: 3,
  };
}

function document(documentId, marker, conformance = "strict") {
  return {
    documentId,
    path: `${documentId}.md`,
    type: "note",
    conformance,
    diagnostics: conformance === "degraded"
      ? [{
          code: "ERR_OKF_FIELD",
          message: "runtime smoke fixture degradation",
          field: "stale_after",
          path: `${documentId}.md`,
        }]
      : [],
    sections: [section(documentId, marker, conformance)],
  };
}

const native = api.NativeOkfSearch.fromPrepared([
  document("first", "native-boundary-marker"),
]);

assert.deepEqual(native.listTypes(), ["note"]);
assert.deepEqual(native.listDegradedDocuments(), []);
const initialHits = native.search("native-boundary-marker", {
  fields: ["body"],
  limit: 1,
});
assert.equal(initialHits.length, 1);
assert.equal(initialHits[0].documentId, "first");
assert.equal(initialHits[0].sectionId, "first#root");
assert.deepEqual(native.search("native", null), native.search("native"));

for (const [name, options] of [
  ["unknown top-level only", { typo: true }],
  ["unknown top-level mixed", { limit: 1, typo: true }],
  ["unknown where only", { where: { typo: ["note"] } }],
  ["unknown where mixed", { where: { types: ["note"], typo: true } }],
  ["unknown where before value conversion", { where: { stale: "invalid", typo: true } }],
  ["unknown boost only", { boost: { typo: 2 } }],
  ["unknown boost mixed", { boost: { body: 2, typo: 2 } }],
  ["unknown boost before value conversion", { boost: { body: "invalid", typo: 2 } }],
]) {
  assert.throws(
    () => native.search("native", options),
    (error) => error instanceof Error &&
      error.message.includes("[ERR_OKF_INVALID_SEARCH_OPTIONS]") &&
      error.message.includes("typo"),
    `${name} must reject through the N-API binding`,
  );
}

native.ingestPrepared(document("second", "native-mutation-marker"));
assert.equal(
  native.search("native-mutation-marker", { match: "all" }).length,
  1,
);
assert.equal(
  native.removeDocument({ documentId: "second", path: "second.md" }),
  true,
);
assert.deepEqual(
  native.search("native-mutation-marker", { match: "all" }),
  [],
);
assert.equal(
  native.removeDocument({ documentId: "missing", path: "missing.md" }),
  false,
);

assert.throws(
  () => native.autoSuggest("native"),
  (error) => error instanceof Error &&
    error.message.includes("[ERR_OKF_UNSUPPORTED]") &&
    error.message.includes("autoSuggest"),
  "autoSuggest must remain explicitly unsupported",
);

console.log("native runtime smoke passed");
