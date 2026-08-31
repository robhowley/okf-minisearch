import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8"),
);
const targetToArtifact = {
  "x86_64-apple-darwin": "okf-search-native.darwin-x64.node",
  "aarch64-apple-darwin": "okf-search-native.darwin-arm64.node",
  "x86_64-pc-windows-msvc": "okf-search-native.win32-x64-msvc.node",
  "x86_64-unknown-linux-gnu": "okf-search-native.linux-x64-gnu.node",
};
const targets = manifest.napi?.targets;
assert.ok(Array.isArray(targets), "package.json must declare napi.targets");
const expected = targets.map((target) => {
  const artifact = targetToArtifact[target];
  assert.ok(artifact, `unsupported napi target in package.json: ${target}`);
  return artifact;
});
assert.equal(
  new Set(expected).size,
  expected.length,
  "package.json must not declare duplicate napi targets",
);

const entries = await readdir(packageRoot, { withFileTypes: true });
const actual = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".node"))
  .map((entry) => entry.name)
  .sort();
const sortedExpected = [...expected].sort();
assert.deepEqual(
  actual,
  sortedExpected,
  `native release artifacts must be exactly ${sortedExpected.join(", ")}`,
);

for (const artifact of sortedExpected) {
  const details = await stat(join(packageRoot, artifact));
  assert.ok(details.size > 0, `${artifact} must not be empty`);
}

console.log(`native release artifacts complete: ${sortedExpected.join(", ")}`);
