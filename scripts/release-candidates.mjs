#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

export const PUBLIC_PACKAGES = Object.freeze([
  { path: "packages/okf-minisearch", name: "okf-minisearch" },
  { path: "packages/pi-okf-search", name: "pi-okf-search" },
  { path: "packages/okf-search-native", name: "okf-search-native" },
])

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const SHA = /^[0-9a-f]{40}$/

function fail(message) {
  throw new Error(message)
}

function checkedCommit(value, context) {
  const commit = String(value ?? "").toLowerCase()
  if (!SHA.test(commit)) fail(`${context} is not a full commit SHA`)
  return commit
}

function validateManifest(spec, manifest) {
  if (manifest === null) return null
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail(`${spec.path}/package.json is malformed`)
  }
  if (manifest.name !== spec.name) {
    fail(`${spec.path} must have package name ${spec.name}`)
  }
  if (typeof manifest.version !== "string" || !SEMVER.test(manifest.version)) {
    fail(`${spec.path} has an invalid package version`)
  }
  if (manifest.private === true) fail(`${spec.path} is private`)

  return {
    ...spec,
    version: manifest.version,
    tag: `${spec.name}-v${manifest.version}`,
  }
}

function validateRelease(release, tag) {
  if (!release || typeof release !== "object" || Array.isArray(release)) {
    fail(`GitHub release ${tag} is malformed`)
  }
  if (release.tag_name !== tag || typeof release.draft !== "boolean") {
    fail(`GitHub release ${tag} does not match its exact tag`)
  }
  return release
}

export async function selectReleaseCandidates({
  eventName,
  eventCommit,
  releaseTag,
  readManifest,
  resolveTag,
  getRelease,
}) {
  if (eventName !== "push" && eventName !== "workflow_dispatch") {
    fail(`unsupported event ${eventName}`)
  }

  let selectedCommit
  if (eventName === "workflow_dispatch") {
    if (typeof releaseTag !== "string" || releaseTag.length === 0) {
      fail("workflow_dispatch requires release_tag")
    }
    selectedCommit = await resolveTag(releaseTag)
    if (selectedCommit === null) fail(`release tag ${releaseTag} does not resolve to a commit`)
    selectedCommit = checkedCommit(selectedCommit, `release tag ${releaseTag}`)
  } else {
    selectedCommit = checkedCommit(eventCommit, "event commit")
  }

  const packages = []
  for (const spec of PUBLIC_PACKAGES) {
    const manifest = await readManifest(selectedCommit, spec.path)
    const packageMetadata = validateManifest(spec, manifest)
    if (packageMetadata) packages.push(packageMetadata)
  }

  let explicitRelease = null
  if (eventName === "workflow_dispatch") {
    if (!packages.some((candidate) => candidate.tag === releaseTag)) {
      fail(`release tag ${releaseTag} is not the expected tag for an allowlisted package at ${selectedCommit}`)
    }
    explicitRelease = await getRelease(releaseTag)
    if (explicitRelease === null) fail(`GitHub release ${releaseTag} does not exist`)
    validateRelease(explicitRelease, releaseTag)
    if (explicitRelease.draft) fail(`GitHub release ${releaseTag} is a draft`)
  }

  const candidates = []
  for (const packageMetadata of packages) {
    const tagCommit = await resolveTag(packageMetadata.tag)
    if (tagCommit === null || checkedCommit(tagCommit, `release tag ${packageMetadata.tag}`) !== selectedCommit) {
      continue
    }

    const release = packageMetadata.tag === releaseTag && explicitRelease
      ? explicitRelease
      : await getRelease(packageMetadata.tag)
    if (release === null) continue
    validateRelease(release, packageMetadata.tag)
    if (!release.draft) candidates.push(packageMetadata)
  }

  return { commit: selectedCommit, packages: candidates }
}

export function resolveTagCommit(tag, cwd = process.cwd()) {
  if (typeof tag !== "string" || tag.length === 0) fail("release tag is empty")
  try {
    execFileSync("git", ["check-ref-format", `refs/tags/${tag}`], { cwd, stdio: "ignore" })
    return execFileSync(
      "git",
      ["rev-parse", "--verify", `${`refs/tags/${tag}`}^{commit}`],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim().toLowerCase()
  } catch {
    return null
  }
}

function readManifestAtCommit(commit, packagePath, cwd = process.cwd()) {
  const object = `${commit}:${packagePath}/package.json`
  try {
    execFileSync("git", ["cat-file", "-e", object], { cwd, stdio: "ignore" })
  } catch {
    return null
  }

  let source
  try {
    source = execFileSync("git", ["show", object], { cwd, encoding: "utf8" })
  } catch {
    fail(`cannot read ${packagePath}/package.json at ${commit}`)
  }
  try {
    return JSON.parse(source)
  } catch {
    fail(`${packagePath}/package.json is not valid JSON at ${commit}`)
  }
}

function githubReleaseClient(repository, token, fetchImpl = fetch) {
  if (!/^[^/]+\/[^/]+$/.test(repository ?? "")) fail("GITHUB_REPOSITORY is invalid")
  if (typeof token !== "string" || token.length === 0) fail("GITHUB_TOKEN is required")

  return async (tag) => {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "user-agent": "okf-release-publication",
          "x-github-api-version": "2022-11-28",
        },
      },
    )
    if (response.status === 404) return null
    if (response.status !== 200) {
      fail(`GitHub release lookup for ${tag} returned HTTP ${response.status}`)
    }
    try {
      return await response.json()
    } catch {
      fail(`GitHub release ${tag} returned malformed JSON`)
    }
  }
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME
  const result = await selectReleaseCandidates({
    eventName,
    eventCommit: process.env.GITHUB_SHA,
    releaseTag: process.env.RELEASE_TAG,
    readManifest: (commit, packagePath) => readManifestAtCommit(commit, packagePath),
    resolveTag: (tag) => resolveTagCommit(tag),
    getRelease: githubReleaseClient(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN),
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
