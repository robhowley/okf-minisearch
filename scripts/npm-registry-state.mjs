#!/usr/bin/env node

import { fileURLToPath } from "node:url"

export const NPM_REGISTRY = "https://registry.npmjs.org"

function fail(message) {
  throw new Error(message)
}

export async function exactPackageState(name, version, fetchImpl = fetch) {
  if (typeof name !== "string" || name.length === 0) fail("package name is required")
  if (typeof version !== "string" || version.length === 0) fail("package version is required")

  let response
  const url = `${NPM_REGISTRY}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "error",
    })
  } catch (error) {
    fail(`npm registry lookup for ${name}@${version} failed: ${error instanceof Error ? error.message : error}`)
  }

  if (response.status === 404) return "unpublished"
  if (response.status !== 200) {
    fail(`npm registry lookup for ${name}@${version} returned HTTP ${response.status}`)
  }

  let metadata
  try {
    metadata = await response.json()
  } catch {
    fail(`npm registry returned malformed JSON for ${name}@${version}`)
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    fail(`npm registry returned malformed metadata for ${name}@${version}`)
  }
  if (metadata.name !== name || metadata.version !== version) {
    fail(`npm registry returned mismatched identity for ${name}@${version}`)
  }
  return "published"
}

async function main() {
  const [name, version, ...extra] = process.argv.slice(2)
  if (extra.length > 0) fail("usage: npm-registry-state.mjs <name> <version>")
  process.stdout.write(`${await exactPackageState(name, version)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
