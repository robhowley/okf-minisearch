#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

function fail(message) {
  throw new Error(message)
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) fail(`${command} ${args.join(" ")} exited with ${result.status}`)
}

async function main() {
  const args = process.argv.slice(2)
  const specifier = args.shift()
  let tsc = null
  if (args[0] === "--typescript") {
    args.shift()
    tsc = args.shift()
  }
  if (!specifier || args.length || (tsc !== null && !tsc)) {
    fail("usage: verify-native-consumer.mjs <tarball|exact-package-specifier> [--typescript <tsc-entry>]")
  }

  const dependency = isAbsolute(specifier) || specifier.endsWith(".tgz")
    ? resolve(specifier)
    : specifier
  const root = await mkdtemp(join(tmpdir(), "okf-native-release-consumer-"))
  try {
    await writeFile(join(root, "package.json"), `${JSON.stringify({
      name: "okf-native-release-consumer",
      private: true,
      type: "module",
    }, null, 2)}\n`)
    await mkdir(join(root, "fixture", "nested"), { recursive: true })
    await writeFile(join(root, "fixture", "nested", "directory.md"), "---\ntype: guide\n---\nrelease-directory-needle\n")

    const npm = process.platform === "win32" ? "npm.cmd" : "npm"
    run(npm, [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--save-exact",
      dependency,
    ], root)

    await writeFile(join(root, "root.mjs"), `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as api from "okf-search-native";
assert.deepEqual(Object.keys(api).sort(), ["OkfError", "createOkfSearch", "openOkf", "validateOkfDocument"]);
await assert.rejects(import("okf-search-native/native.cjs"), (error) => error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED");
const raw = { path: "raw.md", markdown: "---\\ntype: note\\n---\\nrelease-raw-needle\\n" };
assert.deepEqual(api.validateOkfDocument(raw), { isValid: true, isIndexable: true, errors: [] });
const index = api.createOkfSearch([raw]);
assert.equal(index.search("release-raw-needle")[0]?.documentId, "raw");
assert.equal(index.ingest({ path: "added.md", markdown: "---\\ntype: added\\n---\\nrelease-added-needle\\n" }).conformance, "strict");
assert.deepEqual(index.listTypes(), ["added", "note"]);
assert.equal(index.remove("./added.md"), true);
assert.deepEqual(index.search("release-added-needle"), []);
assert.throws(() => index.autoSuggest("release"), (error) => error instanceof api.OkfError && error.code === "ERR_OKF_UNSUPPORTED");
const fixture = join(process.cwd(), "fixture");
const source = join(fixture, "nested", "directory.md");
const before = await readFile(source, "utf8");
const opened = await api.openOkf(fixture);
assert.equal(opened.search("release-directory-needle")[0]?.path, "nested/directory.md");
assert.equal(opened.remove("nested/directory.md"), true);
assert.deepEqual(opened.search("release-directory-needle"), []);
assert.equal(await readFile(source, "utf8"), before);
`)
    await writeFile(join(root, "root.cjs"), `const assert = require("node:assert/strict");
const api = require("okf-search-native");
assert.deepEqual(Object.keys(api).sort(), ["OkfError", "createOkfSearch", "openOkf", "validateOkfDocument"]);
const index = api.createOkfSearch([{ path: "cjs.md", markdown: "---\\ntype: cjs\\n---\\nrelease-cjs-needle\\n" }]);
assert.equal(index.search("release-cjs-needle").length, 1);
`)
    await writeFile(join(root, "prepared.mjs"), `import assert from "node:assert/strict";
import { NativeOkfSearch } from "okf-search-native/prepared";
const section = { sectionId: "prepared#root", documentId: "prepared", conformance: "strict", title: "Prepared", path: "prepared.md", type: "note", tags: ["release"], status: "stable", stalenessClassified: true, trustTier: "human-reviewed", resource: "prepared", headingPath: "Prepared", description: "release fixture", sourceText: "", text: "release-prepared-needle", startLine: 1, endLine: 3 };
const document = { documentId: "prepared", path: "prepared.md", type: "note", conformance: "strict", diagnostics: [], sections: [section] };
const index = NativeOkfSearch.fromPrepared([document]);
assert.equal(index.search("release-prepared-needle")[0]?.documentId, "prepared");
index.ingestPrepared({ ...document, type: "guide", sections: [{ ...section, type: "guide", text: "release-prepared-replacement" }] });
assert.deepEqual(index.listTypes(), ["guide"]);
assert.equal(index.removeDocument({ documentId: "prepared", path: "prepared.md" }), true);
assert.deepEqual(index.listTypes(), []);
`)
    await writeFile(join(root, "prepared.cjs"), `const assert = require("node:assert/strict");
const { NativeOkfSearch } = require("okf-search-native/prepared");
assert.deepEqual(NativeOkfSearch.fromPrepared([]).search("empty"), []);
`)

    for (const file of ["root.mjs", "root.cjs", "prepared.mjs", "prepared.cjs"]) {
      run(process.execPath, [file], root)
    }

    if (tsc) {
      const types = `import { createOkfSearch, openOkf, type OkfSearch } from "okf-search-native";
import { NativeOkfSearch, type PreparedDocument } from "okf-search-native/prepared";
const handle: OkfSearch = createOkfSearch([]);
const opened: Promise<OkfSearch> = openOkf(".");
const prepared: PreparedDocument[] = [];
const native = NativeOkfSearch.fromPrepared(prepared);
void [handle, opened, native];
`
      await writeFile(join(root, "types.mts"), types)
      await writeFile(join(root, "types.cts"), types)
      await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
        },
        include: ["types.mts", "types.cts"],
      }, null, 2)}\n`)
      run(process.execPath, [resolve(tsc), "--project", "tsconfig.json", "--pretty", "false"], root)
    }

    console.log(`verified clean scripts-disabled native consumer for ${specifier}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
