import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const GLIBC_CEILING = "GLIBC_2.17";
const GLIBC_VERSION = /GLIBC_[0-9]+(?:\.[0-9]+)*/g;
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

function compareGlibcVersions(left, right) {
  const leftParts = left.slice("GLIBC_".length).split(".").map(Number);
  const rightParts = right.slice("GLIBC_".length).split(".").map(Number);
  for (let index = 0; index < Math.min(leftParts.length, rightParts.length); index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return leftParts.length - rightParts.length;
}

export function verifyGlibcFloor(
  artifact,
  { runCommand = spawnSync } = {},
) {
  const result = runCommand("objdump", ["-T", artifact], { encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `objdump failed for ${artifact}${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
  );
  const versions = [...new Set(result.stdout.match(GLIBC_VERSION) ?? [])]
    .sort(compareGlibcVersions);
  assert.ok(versions.length > 0, `${artifact} imports no GLIBC symbols`);
  const maximum = versions.at(-1);
  assert.ok(
    compareGlibcVersions(maximum, GLIBC_CEILING) <= 0,
    `${artifact} imports ${maximum}, newer than ${GLIBC_CEILING}`,
  );
  return { versions, maximum };
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
  if (process.argv[2] === "glibc" && process.argv[3] && process.argv.length === 4) {
    const { versions, maximum } = verifyGlibcFloor(resolve(process.argv[3]));
    console.log(`Imported GLIBC symbol versions: ${versions.join(", ")}`);
    console.log(`Maximum imported GLIBC symbol: ${maximum}`);
  } else {
    assert.equal(process.argv.length, 2, "usage: verify-release-artifacts.mjs [glibc <artifact>]");
    const artifacts = await verifyReleaseArtifacts();
    console.log(`native release artifacts complete: ${artifacts.join(", ")}`);
  }
}
