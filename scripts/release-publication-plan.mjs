#!/usr/bin/env node

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const PACKAGES = new Map([
  ["packages/okf-minisearch", "okf-minisearch"],
  ["packages/pi-okf-search", "pi-okf-search"],
  ["packages/okf-search-native", "okf-search-native"],
])
const SHA = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const SRI = /^sha512-[A-Za-z0-9+/]{86}==$/
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function fail(message) {
  throw new Error(message)
}

function runTar(args) {
  const result = spawnSync("tar", args, { encoding: "utf8" })
  if (result.error) throw result.error
  if (result.status !== 0) fail(`tar ${args.join(" ")} failed: ${result.stderr.trim()}`)
  return result.stdout
}

async function regularFiles(root, directory = root) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await regularFiles(root, path))
    } else {
      assert.equal(entry.isFile(), true, `publication artifact contains a non-regular entry: ${entry.name}`)
      files.push(path)
    }
  }
  return files
}

export async function inspectPublicationArtifact(tarball, path, name, version, sourceCommit) {
  assert.equal(PACKAGES.get(path), name, "publication artifact package path/name mismatch")
  assert.match(version ?? "", SEMVER, "publication artifact version")
  assert.match(sourceCommit ?? "", SHA, "publication artifact source commit")

  const archive = await readFile(tarball)
  assert.ok(archive.length > 0, "publication artifact must not be empty")
  const listing = runTar(["-tzf", tarball]).split(/\r?\n/).filter(Boolean)
  assert.ok(listing.length > 0, "publication artifact has no entries")
  for (const entry of listing) {
    assert.ok(entry === "package" || entry === "package/" || entry.startsWith("package/"), `publication artifact path escapes package/: ${entry}`)
    assert.equal(entry.split("/").includes(".."), false, `publication artifact path contains ..: ${entry}`)
  }

  const extractionRoot = await mkdtemp(join(tmpdir(), "okf-publication-artifact-"))
  try {
    runTar(["-xzf", tarball, "-C", extractionRoot])
    const packageRoot = join(extractionRoot, "package")
    const files = await regularFiles(packageRoot)
    let unpackedBytes = 0
    for (const file of files) unpackedBytes += (await stat(file)).size
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"))
    assert.equal(manifest.name, name, "publication artifact package name")
    assert.equal(manifest.version, version, "publication artifact package version")

    return {
      path,
      name,
      version,
      tarball: basename(tarball),
      sourceCommit,
      sha256: createHash("sha256").update(archive).digest("hex"),
      integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
      compressedBytes: archive.length,
      unpackedBytes,
    }
  } finally {
    await rm(extractionRoot, { recursive: true, force: true })
  }
}

function assertPlanEntry(entry, sourceCommit) {
  assert.deepEqual(Object.keys(entry).sort(), [
    "compressedBytes", "distTag", "integrity", "name", "path", "preflightState",
    "sha256", "sourceCommit", "tarball", "unpackedBytes", "version",
  ])
  assert.equal(PACKAGES.get(entry.path), entry.name, "publication plan package path/name mismatch")
  assert.match(entry.version ?? "", SEMVER)
  assert.equal(entry.sourceCommit, sourceCommit, "publication plan source commit mismatch")
  assert.match(entry.sourceCommit ?? "", SHA)
  assert.match(entry.sha256 ?? "", SHA256)
  assert.match(entry.integrity ?? "", SRI)
  assert.ok(Number.isSafeInteger(entry.compressedBytes) && entry.compressedBytes > 0)
  assert.ok(Number.isSafeInteger(entry.unpackedBytes) && entry.unpackedBytes > 0)
  assert.ok(["published", "unpublished"].includes(entry.preflightState), "publication plan registry state")
  assert.ok(entry.distTag === "latest" || entry.distTag === null, "publication plan dist-tag policy")
  assert.equal(basename(entry.tarball ?? ""), entry.tarball, "publication plan tarball must be a filename")
}

export async function verifyPublicationPlan(directory, plan, sourceCommit) {
  assert.match(sourceCommit ?? "", SHA, "publication plan source commit")
  assert.ok(Array.isArray(plan) && plan.length > 0, "publication plan must contain selected packages")
  assert.equal(new Set(plan.map(({ name }) => name)).size, plan.length, "publication plan contains duplicate packages")

  for (const entry of plan) {
    assertPlanEntry(entry, sourceCommit)
    const actual = await inspectPublicationArtifact(
      join(directory, entry.tarball), entry.path, entry.name, entry.version, sourceCommit,
    )
    assert.deepEqual(actual, Object.fromEntries(
      Object.entries(entry).filter(([key]) => !["distTag", "preflightState"].includes(key)),
    ), `${entry.name}@${entry.version} publication artifact bytes changed`)
  }
  return plan
}

async function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === "inspect" && args.length === 5) {
    process.stdout.write(`${JSON.stringify(await inspectPublicationArtifact(...args))}\n`)
    return
  }
  if (mode === "verify" && args.length === 3) {
    const [directory, planPath, sourceCommit] = args
    const plan = JSON.parse(await readFile(resolve(planPath), "utf8"))
    await verifyPublicationPlan(resolve(directory), plan, sourceCommit)
    console.log(`verified ${plan.length} immutable publication artifact(s)`)
    return
  }
  fail("usage: release-publication-plan.mjs inspect <tarball> <package-path> <name> <version> <source-commit> | verify <artifact-directory> <plan.json> <source-commit>")
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
