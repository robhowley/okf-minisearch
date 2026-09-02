import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import * as minisearch from "../packages/okf-minisearch/dist/index.js";
import * as native from "../packages/okf-search-native/dist/index.mjs";

const bundle = fileURLToPath(
  new URL("../demo/assets/sample-bundle/", import.meta.url),
);

const queries = [
  {
    name: "stable garden concepts",
    query: "seasonal planning",
    options: {
      limit: 5,
      fields: ["title", "heading", "body"],
      match: "any",
      where: {
        types: ["concept"],
        tagsAny: ["garden", "planning"],
        statuses: ["stable"],
        trustTiers: ["unverified"],
        conformance: ["strict"],
      },
    },
  },
  {
    name: "stable safety material",
    query: "inspection safety",
    options: {
      limit: 5,
      fields: ["title", "description", "body"],
      match: "any",
      where: {
        tagsAny: ["inspection", "safety"],
        statuses: ["stable"],
        conformance: ["strict"],
      },
    },
  },
  {
    name: "draft schedules",
    query: "schedule",
    options: {
      limit: 5,
      where: {
        types: ["concept"],
        statuses: ["draft"],
        conformance: ["strict"],
      },
    },
  },
  {
    name: "degraded mulch notes",
    query: "mulch",
    options: {
      limit: 5,
      where: { conformance: ["degraded"] },
    },
  },
];

const searchHitTypeShape = {
  documentId: "string",
  title: "string",
  sectionId: "string",
  score: "number",
  conformance: "string",
  matchedFields: "array",
  headingPath: "string",
  path: "string",
  startLine: "number",
  endLine: "number",
  snippet: "string",
};

async function inspectBackend(name, api) {
  const index = await api.openOkf(bundle);
  const searches = queries.map(({ name: queryName, query, options }) => ({
    name: queryName,
    query,
    options,
    hits: index.search(query, options),
  }));

  for (const search of searches) {
    assert.ok(search.hits.length > 0, `${name}: ${search.name} returned no hits`);
  }

  return {
    name,
    searches,
    degradedDocuments: index.listDegradedDocuments(),
  };
}

const [miniResult, nativeResult] = await Promise.all([
  inspectBackend("okf-minisearch", minisearch),
  inspectBackend("okf-search-native", native),
]);

for (const result of [miniResult, nativeResult]) {
  for (const search of result.searches) {
    for (const hit of search.hits) {
      assert.deepEqual(
        typeShape(hit),
        searchHitTypeShape,
        `${result.name}: ${search.name} returned an incompatible hit`,
      );
    }
  }
}

assert.deepEqual(
  nativeResult.degradedDocuments,
  miniResult.degradedDocuments,
  "degraded document inventories differ",
);

console.dir({ bundle, results: [miniResult, nativeResult] }, { depth: null });
console.log("\nPASS: search hit types match; degraded documents and diagnostics match exactly.");

function typeShape(hit) {
  return Object.fromEntries(Object.entries(hit).map(([key, value]) => [
    key,
    Array.isArray(value) ? "array" : typeof value,
  ]));
}
