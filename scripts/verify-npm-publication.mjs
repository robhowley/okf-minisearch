#!/usr/bin/env node

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const NPM_REGISTRY = "https://registry.npmjs.org"
export const PROVENANCE_PREDICATE = "https://slsa.dev/provenance/v1"
const STATEMENT_TYPE = "https://in-toto.io/Statement/v1"
const WORKFLOW_BUILD_TYPE = "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1"
const BUNDLE_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json"
const BUILDER = "https://github.com/actions/runner/github-hosted"

function fail(message) {
  throw new Error(message)
}

async function get(url, accept, fetchImpl) {
  let response
  try {
    response = await fetchImpl(url, { headers: { accept }, redirect: "error" })
  } catch (error) {
    fail(`request failed for ${url}: ${error instanceof Error ? error.message : error}`)
  }
  if (response.status !== 200) fail(`request for ${url} returned HTTP ${response.status}`)
  return response
}

async function json(response, context) {
  try {
    const value = await response.json()
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${context} is malformed`)
    return value
  } catch (error) {
    if (error instanceof Error && error.message === `${context} is malformed`) throw error
    fail(`${context} returned malformed JSON`)
  }
}

function decodePayload(value) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail("provenance payload is not canonical base64")
  }
  let payload
  try {
    payload = JSON.parse(Buffer.from(value, "base64").toString("utf8"))
  } catch {
    fail("provenance payload is not valid JSON")
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("provenance payload is malformed")
  return payload
}

function sha512Hex(integrity) {
  assert.match(integrity ?? "", /^sha512-[A-Za-z0-9+/]{86}==$/, "candidate integrity")
  return Buffer.from(integrity.slice("sha512-".length), "base64").toString("hex")
}

export function verifyProvenance(attestations, candidate, { repository, workflow }) {
  assert.ok(attestations && typeof attestations === "object" && !Array.isArray(attestations), "attestation response is malformed")
  assert.ok(Array.isArray(attestations.attestations), "attestation response has no attestations array")
  const matches = attestations.attestations.filter((item) => item?.predicateType === PROVENANCE_PREDICATE)
  assert.equal(matches.length, 1, "expected exactly one supported provenance attestation")

  const bundle = matches[0].bundle
  assert.equal(bundle?.mediaType, BUNDLE_MEDIA_TYPE, "unsupported provenance bundle schema")
  assert.match(bundle?.verificationMaterial?.certificate?.rawBytes ?? "", /^[A-Za-z0-9+/]+={0,2}$/, "provenance certificate is missing")
  assert.ok(Array.isArray(bundle?.verificationMaterial?.tlogEntries) && bundle.verificationMaterial.tlogEntries.length > 0, "provenance transparency log proof is missing")
  assert.equal(bundle?.dsseEnvelope?.payloadType, "application/vnd.in-toto+json")
  assert.ok(Array.isArray(bundle?.dsseEnvelope?.signatures) && bundle.dsseEnvelope.signatures.length > 0, "provenance signature is missing")

  const statement = decodePayload(bundle.dsseEnvelope.payload)
  assert.equal(statement._type, STATEMENT_TYPE)
  assert.equal(statement.predicateType, PROVENANCE_PREDICATE)
  assert.deepEqual(statement.subject, [{
    name: `pkg:npm/${candidate.name}@${candidate.version}`,
    digest: { sha512: sha512Hex(candidate.integrity) },
  }], "provenance subject does not match candidate")

  const build = statement.predicate?.buildDefinition
  assert.equal(build?.buildType, WORKFLOW_BUILD_TYPE)
  assert.deepEqual(build?.externalParameters?.workflow, {
    ref: "refs/heads/main",
    repository,
    path: workflow,
  }, "provenance workflow identity does not match")
  assert.equal(statement.predicate?.runDetails?.builder?.id, BUILDER)
  assert.match(
    statement.predicate?.runDetails?.metadata?.invocationId ?? "",
    new RegExp(`^${repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/actions/runs/[0-9]+/attempts/[0-9]+$`),
    "provenance invocation identity does not match",
  )

  const dependencies = build?.resolvedDependencies
  assert.ok(Array.isArray(dependencies), "provenance resolvedDependencies is missing")
  assert.equal(dependencies.some((dependency) =>
    dependency?.uri === `git+${repository}@refs/heads/main` &&
    dependency?.digest?.gitCommit === candidate.releaseCommit), true,
  "provenance release commit does not match")
}

export async function verifyNpmPublication(candidate, {
  owner,
  repository,
  workflow,
  distTag = "latest",
  fetchImpl = fetch,
} = {}) {
  assert.equal(candidate?.name, "okf-search-native")
  assert.match(candidate?.version ?? "", /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  assert.match(candidate?.releaseCommit ?? "", /^[0-9a-f]{40}$/)
  assert.match(candidate?.sha256 ?? "", /^[0-9a-f]{64}$/)
  assert.equal(typeof owner, "string", "expected npm owner is required")
  assert.match(repository ?? "", /^https:\/\/github\.com\/[^/]+\/[^/]+$/)
  assert.match(workflow ?? "", /^\.github\/workflows\/[^/]+\.ya?ml$/)
  assert.match(distTag, /^[a-z0-9][a-z0-9._-]*$/)

  const encodedName = encodeURIComponent(candidate.name)
  const packument = await json(
    await get(`${NPM_REGISTRY}/${encodedName}`, "application/json", fetchImpl),
    `${candidate.name} packument`,
  )
  assert.equal(packument.name, candidate.name, "registry package name does not match")
  assert.equal(packument["dist-tags"]?.[distTag], candidate.version, `${distTag} dist-tag does not match`)
  assert.equal(Array.isArray(packument.maintainers) && packument.maintainers.some((maintainer) => maintainer?.name === owner), true, "npm owner does not match")

  const version = packument.versions?.[candidate.version]
  assert.ok(version && typeof version === "object" && !Array.isArray(version), "exact registry version is missing")
  assert.equal(version.name, candidate.name)
  assert.equal(version.version, candidate.version)
  assert.equal(version.dist?.integrity, candidate.integrity, "registry integrity does not match candidate")
  assert.match(version.dist?.tarball ?? "", /^https:\/\/registry\.npmjs\.org\//)

  const registryBytes = Buffer.from(await (await get(version.dist.tarball, "application/octet-stream", fetchImpl)).arrayBuffer())
  assert.equal(createHash("sha256").update(registryBytes).digest("hex"), candidate.sha256, "registry tarball SHA-256 does not match candidate")
  assert.equal(`sha512-${createHash("sha512").update(registryBytes).digest("base64")}`, candidate.integrity, "registry tarball SRI does not match candidate")

  const attestationUrl = `${NPM_REGISTRY}/-/npm/v1/attestations/${candidate.name}@${candidate.version}`
  assert.equal(version.dist?.attestations?.url, attestationUrl, "registry provenance URL does not match")
  assert.equal(version.dist?.attestations?.provenance?.predicateType, PROVENANCE_PREDICATE, "registry provenance predicate does not match")
  const attestations = await json(
    await get(attestationUrl, "application/json", fetchImpl),
    `${candidate.name} provenance`,
  )
  verifyProvenance(attestations, candidate, { repository, workflow })
  return { name: candidate.name, version: candidate.version, sha256: candidate.sha256 }
}

async function verifyRegistrySignatures(name, version) {
  const root = await mkdtemp(join(tmpdir(), "okf-native-provenance-"))
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"
  const run = (args) => {
    const result = spawnSync(npm, args, { cwd: root, encoding: "utf8", stdio: "inherit" })
    if (result.error) throw result.error
    if (result.status !== 0) fail(`npm ${args.join(" ")} exited with ${result.status}`)
  }
  try {
    await writeFile(join(root, "package.json"), `${JSON.stringify({
      name: "okf-native-provenance-verifier",
      version: "1.0.0",
      private: true,
      dependencies: { [name]: version },
    }, null, 2)}\n`)
    run(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--registry", NPM_REGISTRY])
    run(["audit", "signatures", "--registry", NPM_REGISTRY])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function main() {
  const [metadataPath, owner, repository, workflow, distTag = "latest", ...extra] = process.argv.slice(2)
  if (extra.length || !metadataPath || !owner || !repository || !workflow) {
    fail("usage: verify-npm-publication.mjs <candidate.json> <owner> <repository-url> <workflow-path> [dist-tag]")
  }
  const candidate = JSON.parse(await readFile(resolve(metadataPath), "utf8"))
  const result = await verifyNpmPublication(candidate, { owner, repository, workflow, distTag })
  await verifyRegistrySignatures(result.name, result.version)
  console.log(`verified npm bytes, signed provenance, and identity for ${result.name}@${result.version} (${result.sha256})`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
