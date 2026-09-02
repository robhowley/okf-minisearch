import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("manifest exposes only the friendly root and prepared binding", async () => {
  const manifest = await readJson(join(packageRoot, "package.json"));

  assert.equal(manifest.type, undefined);
  assert.equal(manifest.main, "./dist/index.cjs");
  assert.equal(manifest.module, "./dist/index.mjs");
  assert.equal(manifest.types, "./dist/index.d.ts");
  assert.deepEqual(manifest.exports, {
    ".": {
      import: {
        types: "./dist/index.d.mts",
        default: "./dist/index.mjs",
      },
      require: {
        types: "./dist/index.d.cts",
        default: "./dist/index.cjs",
      },
      default: "./dist/index.mjs",
    },
    "./prepared": {
      types: "./native.d.cts",
      import: "./native.cjs",
      require: "./native.cjs",
      default: "./native.cjs",
    },
  });
  assert.deepEqual(manifest.files, [
    "dist",
    "native.cjs",
    "native.d.cts",
    "okf-search-native.*.node",
  ]);
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.optionalDependencies, undefined);
  assert.equal(manifest.browser, undefined);
  assert.equal(manifest.scripts.install, undefined);
  assert.equal(manifest.exports["./native.cjs"], undefined);
});

test("root declarations are identical and contain no private package reference", async () => {
  const declarations = await Promise.all([
    "index.d.mts",
    "index.d.cts",
    "index.d.ts",
  ].map((filename) => readFile(join(packageRoot, "dist", filename), "utf8")));

  assert.equal(declarations[0], declarations[1]);
  assert.equal(declarations[1], declarations[2]);
  assert.doesNotMatch(declarations[0], /@okf-internal\/prepare|workspace:/);
});

test("ESM and CommonJS resolve the root and prepared subpath", async () => {
  const esmRoot = await import("okf-search-native");
  const cjsRoot = require("okf-search-native");
  const esmPrepared = await import("okf-search-native/prepared");
  const cjsPrepared = require("okf-search-native/prepared");

  for (const root of [esmRoot, cjsRoot]) {
    assert.deepEqual(Object.keys(root).sort(), [
      "OkfError",
      "createOkfSearch",
      "openOkf",
      "validateOkfDocument",
    ]);
    assert.equal("default" in root, false);
    assert.equal("NativeOkfSearch" in root, false);

    const error = new root.OkfError("ERR_OKF_UNSUPPORTED", "autoSuggest");
    assert.equal(error.name, "OkfError");
    assert.equal(error.code, "ERR_OKF_UNSUPPORTED");
    assert.equal(error.path, "autoSuggest");
    assert.equal(error.message, "Unsupported OKF operation: autoSuggest");
    assert.equal(Object.hasOwn(error, "field"), false);
    assert.equal(Object.hasOwn(error, "cause"), false);

    const index = root.createOkfSearch([{
      path: "package-api.md",
      markdown: "---\ntype: note\n---\npackage-api-marker\n",
    }]);
    assert.equal(index.search("package-api-marker")[0]?.documentId, "package-api");
    assert.equal(root.validateOkfDocument({
      path: "valid.md",
      markdown: "---\ntype: note\n---\nvalid\n",
    }).isValid, true);
  }

  for (const prepared of [esmPrepared, cjsPrepared]) {
    assert.equal(typeof prepared.NativeOkfSearch.fromPrepared, "function");
    const index = prepared.NativeOkfSearch.fromPrepared([]);
    assert.deepEqual(index.listTypes(), []);
  }
});

test("the physical generated loader is blocked by the export map", async () => {
  await assert.rejects(
    import("okf-search-native/native.cjs"),
    (error) => error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );
  assert.throws(
    () => require("okf-search-native/native.cjs"),
    (error) => error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );
});
