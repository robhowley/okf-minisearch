import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const targetToArtifact = {
  "x86_64-apple-darwin": "okf-search-native.darwin-x64.node",
  "aarch64-apple-darwin": "okf-search-native.darwin-arm64.node",
  "x86_64-pc-windows-msvc": "okf-search-native.win32-x64-msvc.node",
  "x86_64-unknown-linux-gnu": "okf-search-native.linux-x64-gnu.node",
};

export function expectedArtifactNames(manifest) {
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
  return [...expected].sort();
}

export async function verifyReleaseArtifacts(root = packageRoot) {
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  const expected = expectedArtifactNames(manifest);
  const entries = await readdir(root, { withFileTypes: true });
  const actual = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".node"))
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(
    actual,
    expected,
    `native release artifacts must be exactly ${expected.join(", ")}`,
  );

  for (const artifact of expected) {
    const details = await stat(join(root, artifact));
    assert.ok(details.size > 0, `${artifact} must not be empty`);
  }

  return expected;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const artifacts = await verifyReleaseArtifacts();
  console.log(`native release artifacts complete: ${artifacts.join(", ")}`);
}
