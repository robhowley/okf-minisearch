import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const esmRoot = await import("okf-search-native");
const cjsRoot = require("okf-search-native");
const esmPrepared = await import("okf-search-native/prepared");
const cjsPrepared = require("okf-search-native/prepared");
const rootKeys = [
  "OkfError",
  "createOkfSearch",
  "openOkf",
  "validateOkfDocument",
];

for (const api of [esmRoot, cjsRoot]) {
  assert.deepEqual(Object.keys(api).sort(), rootKeys);
}
assert.deepEqual(Object.keys(cjsPrepared).sort(), ["NativeOkfSearch"]);
assert.equal(typeof esmPrepared.NativeOkfSearch.fromPrepared, "function");

function markdown(type, marker) {
  return `---\ntype: ${type}\n---\n${marker}\n`;
}

function preparedSection(documentId, marker) {
  return {
    sectionId: `${documentId}#root`,
    documentId,
    conformance: "strict",
    title: `Prepared ${marker}`,
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

function preparedDocument(documentId, marker) {
  return {
    documentId,
    path: `${documentId}.md`,
    type: "note",
    conformance: "strict",
    diagnostics: [],
    sections: [preparedSection(documentId, marker)],
  };
}

const index = cjsRoot.createOkfSearch([
  { path: "smoke.md", markdown: markdown("note", "friendly-runtime-marker") },
]);
assert.equal(index.search("friendly-runtime-marker")[0]?.documentId, "smoke");
assert.equal(index.ingest({
  path: "nested/added.md",
  markdown: markdown("guide", "friendly-ingest-marker"),
}).conformance, "strict");
assert.deepEqual(index.listTypes(), ["guide", "note"]);
assert.equal(index.remove("./nested//added.md"), true);
assert.deepEqual(index.listTypes(), ["note"]);
assert.deepEqual(index.search("friendly-ingest-marker", { match: "all" }), []);
assert.throws(
  () => index.autoSuggest("friendly"),
  (error) => error instanceof cjsRoot.OkfError &&
    error.code === "ERR_OKF_UNSUPPORTED" &&
    error.path === "autoSuggest",
);

const prepared = cjsPrepared.NativeOkfSearch.fromPrepared([
  preparedDocument("prepared", "prepared-runtime-marker"),
]);
assert.equal(prepared.search("prepared-runtime-marker")[0]?.documentId, "prepared");
prepared.ingestPrepared(preparedDocument("prepared-added", "prepared-ingest-marker"));
assert.equal(
  prepared.search("prepared-ingest-marker", { match: "all" }).length,
  1,
);
assert.equal(prepared.removeDocument({
  documentId: "prepared-added",
  path: "prepared-added.md",
}), true);
assert.deepEqual(prepared.search("prepared-ingest-marker", { match: "all" }), []);

const directoryRoot = await mkdtemp(join(tmpdir(), "okf-search-native-runtime-"));
try {
  const nestedRoot = join(directoryRoot, "nested");
  await mkdir(nestedRoot, { recursive: true });
  await writeFile(
    join(nestedRoot, "directory.md"),
    markdown("guide", "friendly-directory-marker"),
  );

  const directoryIndex = await cjsRoot.openOkf(directoryRoot);
  assert.equal(
    directoryIndex.search("friendly-directory-marker")[0]?.documentId,
    "nested/directory",
  );
  assert.deepEqual(directoryIndex.listTypes(), ["guide"]);
  assert.equal(directoryIndex.ingest({
    path: "added.md",
    markdown: markdown("note", "friendly-directory-ingest-marker"),
  }).conformance, "strict");
  assert.deepEqual(directoryIndex.listTypes(), ["guide", "note"]);
  assert.equal(directoryIndex.remove("./added.md"), true);
  assert.equal(directoryIndex.remove("nested/directory.md"), true);
  assert.deepEqual(directoryIndex.listTypes(), []);
  assert.deepEqual(
    directoryIndex.search("friendly-directory-marker", { match: "all" }),
    [],
  );
} finally {
  await rm(directoryRoot, { recursive: true, force: true });
}

console.log("native root, prepared, and directory runtime smoke passed");
