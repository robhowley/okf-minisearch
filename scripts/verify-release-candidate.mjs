#!/usr/bin/env node

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const COMPRESSED_LIMIT = 12_000_000
export const UNPACKED_LIMIT = 32_000_000
export const NATIVE_PACKAGE_FILES = Object.freeze([
  "LICENSE",
  "README.md",
  "dist/index.cjs",
  "dist/index.d.cts",
  "dist/index.d.mts",
  "dist/index.d.ts",
  "dist/index.mjs",
  "native.cjs",
  "native.d.cts",
  "okf-search-native.darwin-arm64.node",
  "okf-search-native.darwin-x64.node",
  "okf-search-native.linux-x64-gnu.node",
  "okf-search-native.win32-x64-msvc.node",
  "package.json",
])

const RELEASE_COMMIT = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const SRI = /^sha512-[A-Za-z0-9+/]{86}==$/
const TARGETS = [
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
]

function fail(message) {
  throw new Error(message)
}

function runTar(args) {
  const result = spawnSync("tar", args, { encoding: "utf8" })
  if (result.error) throw result.error
  if (result.status !== 0) fail(`tar ${args.join(" ")} failed: ${result.stderr.trim()}`)
  return result.stdout
}

function digest(algorithm, bytes, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding)
}

function assertManifest(manifest) {
  assert.equal(manifest.name, "okf-search-native", "candidate package name")
  assert.match(manifest.version ?? "", /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/, "candidate package version")
  assert.equal(manifest.private, undefined, "candidate must not be private")
  assert.equal(manifest.type, undefined, "candidate must not set a top-level type")
  assert.equal(manifest.main, "./dist/index.cjs")
  assert.equal(manifest.module, "./dist/index.mjs")
  assert.equal(manifest.types, "./dist/index.d.ts")
  assert.deepEqual(manifest.exports, {
    ".": {
      import: { types: "./dist/index.d.mts", default: "./dist/index.mjs" },
      require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
      default: "./dist/index.mjs",
    },
    "./prepared": {
      types: "./native.d.cts",
      import: "./native.cjs",
      require: "./native.cjs",
      default: "./native.cjs",
    },
  })
  assert.deepEqual(manifest.files, [
    "dist",
    "native.cjs",
    "native.d.cts",
    "okf-search-native.*.node",
  ])
  assert.equal(manifest.engines?.node, ">=22.19.0")
  assert.deepEqual(manifest.repository, {
    type: "git",
    url: "git+https://github.com/robhowley/okf-minisearch.git",
    directory: "packages/okf-search-native",
  }, "candidate repository metadata")
  assert.equal(manifest.napi?.binaryName, "okf-search-native")
  assert.deepEqual(manifest.napi?.targets, TARGETS)
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0, "candidate must have no runtime dependencies")
  assert.equal(Object.keys(manifest.optionalDependencies ?? {}).length, 0, "candidate must have no optional dependencies")
  for (const lifecycle of ["preinstall", "install", "postinstall"]) {
    assert.equal(manifest.scripts?.[lifecycle], undefined, `candidate contains ${lifecycle}`)
  }
  assert.equal(JSON.stringify(manifest).includes("workspace:"), false, "candidate manifest contains workspace:")
}

async function regularFiles(root, directory = root) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await regularFiles(root, path))
    } else {
      assert.equal(entry.isFile(), true, `candidate contains a non-regular entry: ${entry.name}`)
      files.push(path.slice(root.length + 1).replaceAll("\\", "/"))
    }
  }
  return files
}

export async function inspectReleaseCandidate(
  tarball,
  releaseCommit,
  { compressedLimit = COMPRESSED_LIMIT, unpackedLimit = UNPACKED_LIMIT } = {},
) {
  assert.match(releaseCommit ?? "", RELEASE_COMMIT, "release commit must be a full lowercase SHA")
  const archive = await readFile(tarball)
  assert.ok(archive.length > 0, "candidate tarball must not be empty")
  assert.ok(archive.length <= compressedLimit, `candidate compressed bytes ${archive.length} exceed ${compressedLimit}`)

  const listing = runTar(["-tzf", tarball]).split(/\r?\n/).filter(Boolean)
  assert.ok(listing.length > 0, "candidate tarball has no entries")
  for (const entry of listing) {
    assert.ok(entry === "package" || entry === "package/" || entry.startsWith("package/"), `candidate path escapes package/: ${entry}`)
    assert.equal(entry.split("/").includes(".."), false, `candidate path contains ..: ${entry}`)
  }

  const extractionRoot = await mkdtemp(join(tmpdir(), "okf-native-candidate-"))
  try {
    runTar(["-xzf", tarball, "-C", extractionRoot])
    const packageRoot = join(extractionRoot, "package")
    const files = (await regularFiles(packageRoot)).sort()
    assert.deepEqual(files, [...NATIVE_PACKAGE_FILES], "candidate files must match the exact release package")

    let unpackedBytes = 0
    for (const file of files) unpackedBytes += (await stat(join(packageRoot, file))).size
    assert.ok(unpackedBytes <= unpackedLimit, `candidate unpacked bytes ${unpackedBytes} exceed ${unpackedLimit}`)

    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"))
    assertManifest(manifest)
    for (const native of files.filter((file) => file.endsWith(".node"))) {
      assert.ok((await stat(join(packageRoot, native))).size > 0, `${native} must not be empty`)
    }

    return {
      schemaVersion: 1,
      name: manifest.name,
      version: manifest.version,
      releaseCommit,
      sha256: digest("sha256", archive, "hex"),
      integrity: `sha512-${digest("sha512", archive, "base64")}`,
      compressedBytes: archive.length,
      unpackedBytes,
      files,
    }
  } finally {
    await rm(extractionRoot, { recursive: true, force: true })
  }
}

function assertMetadataShape(metadata) {
  assert.deepEqual(Object.keys(metadata).sort(), [
    "compressedBytes", "files", "integrity", "name", "releaseCommit",
    "schemaVersion", "sha256", "unpackedBytes", "version",
  ])
  assert.equal(metadata.schemaVersion, 1)
  assert.equal(metadata.name, "okf-search-native")
  assert.match(metadata.releaseCommit ?? "", RELEASE_COMMIT)
  assert.match(metadata.sha256 ?? "", SHA256)
  assert.match(metadata.integrity ?? "", SRI)
  assert.ok(Number.isSafeInteger(metadata.compressedBytes) && metadata.compressedBytes > 0)
  assert.ok(Number.isSafeInteger(metadata.unpackedBytes) && metadata.unpackedBytes > 0)
  assert.deepEqual(metadata.files, [...NATIVE_PACKAGE_FILES])
}

export async function verifyReleaseCandidate(tarball, metadata, expectedCommit = metadata.releaseCommit) {
  assertMetadataShape(metadata)
  assert.equal(metadata.releaseCommit, expectedCommit, "candidate release commit does not match")
  const actual = await inspectReleaseCandidate(tarball, expectedCommit)
  assert.deepEqual(actual, metadata, "candidate bytes or metadata changed")
  return actual
}

async function main() {
  const [mode, tarballArgument, metadataArgument, commit, ...extra] = process.argv.slice(2)
  if (extra.length || !["create", "verify"].includes(mode) || !tarballArgument || !metadataArgument) {
    fail("usage: verify-release-candidate.mjs <create|verify> <tarball> <metadata.json> [release-commit]")
  }
  const tarball = resolve(tarballArgument)
  const metadataPath = resolve(metadataArgument)

  if (mode === "create") {
    if (!commit) fail("create requires release-commit")
    const metadata = await inspectReleaseCandidate(tarball, commit)
    await import("node:fs/promises").then(({ writeFile }) => writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`))
    console.log(`created ${basename(metadataPath)} for ${metadata.name}@${metadata.version}`)
    return
  }

  const metadata = JSON.parse(await readFile(metadataPath, "utf8"))
  await verifyReleaseCandidate(tarball, metadata, commit ?? metadata.releaseCommit)
  console.log(`verified ${basename(tarball)} as ${metadata.name}@${metadata.version} (${metadata.sha256})`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
