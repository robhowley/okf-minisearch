import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyReleaseArtifacts } from "../scripts/verify-release-artifacts.mjs";

const targets = [
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
];
const artifacts = [
  "okf-search-native.darwin-x64.node",
  "okf-search-native.darwin-arm64.node",
  "okf-search-native.win32-x64-msvc.node",
  "okf-search-native.linux-x64-gnu.node",
];

async function withFixture(files, callback) {
  const root = await mkdtemp(join(tmpdir(), "okf-search-native-artifacts-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ napi: { targets } }),
    );
    await Promise.all(
      files.map((filename) => writeFile(join(root, filename), "native")),
    );
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("accepts the exact four nonempty native artifacts", async () => {
  await withFixture(artifacts, async (root) => {
    assert.deepEqual(await verifyReleaseArtifacts(root), [...artifacts].sort());
  });
});

test("rejects a missing native artifact", async () => {
  await withFixture(artifacts.slice(1), async (root) => {
    await assert.rejects(
      verifyReleaseArtifacts(root),
      /native release artifacts must be exactly/,
    );
  });
});

test("rejects an empty native artifact", async () => {
  await withFixture(artifacts, async (root) => {
    await writeFile(join(root, artifacts[0]), "");
    await assert.rejects(
      verifyReleaseArtifacts(root),
      /must not be empty/,
    );
  });
});

test("rejects an extra native artifact", async () => {
  await withFixture([...artifacts, "unexpected.node"], async (root) => {
    await assert.rejects(
      verifyReleaseArtifacts(root),
      /native release artifacts must be exactly/,
    );
  });
});
