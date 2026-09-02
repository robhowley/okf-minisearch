import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  PUBLIC_PACKAGES,
  resolveTagCommit,
  selectReleaseCandidates,
} from "./release-candidates.mjs"
import { exactPackageState, NPM_REGISTRY } from "./npm-registry-state.mjs"

const fixture = JSON.parse(readFileSync(new URL("./fixtures/release-publication.json", import.meta.url)))

function candidateAdapters({ tags = {}, releases = {}, manifests = fixture.manifests } = {}) {
  const releaseLookups = []
  return {
    releaseLookups,
    readManifest: async (_commit, path) => manifests[path] ?? null,
    resolveTag: async (tag) => tags[tag] ?? null,
    getRelease: async (tag) => {
      releaseLookups.push(tag)
      return releases[tag] ?? null
    },
  }
}

function release(tag, draft = false) {
  return { tag_name: tag, draft }
}

test("push selects only non-draft exact releases at the event commit in fixed order", async () => {
  const tags = {
    "okf-minisearch-v2.3.0": fixture.commit,
    "pi-okf-search-v0.5.0": fixture.otherCommit,
    "okf-search-native-v0.1.0": fixture.commit,
  }
  const releases = {
    "okf-minisearch-v2.3.0": release("okf-minisearch-v2.3.0"),
    "okf-search-native-v0.1.0": release("okf-search-native-v0.1.0"),
  }
  const adapters = candidateAdapters({ tags, releases })

  const result = await selectReleaseCandidates({
    eventName: "push",
    eventCommit: fixture.commit,
    releaseTag: "",
    ...adapters,
  })

  assert.equal(result.commit, fixture.commit)
  assert.deepEqual(result.packages.map(({ path }) => path), [
    "packages/okf-minisearch",
    "packages/okf-search-native",
  ])
  assert.deepEqual(adapters.releaseLookups, [
    "okf-minisearch-v2.3.0",
    "okf-search-native-v0.1.0",
  ])
})

test("ordinary push with no matching release tags is a no-op", async () => {
  const adapters = candidateAdapters()
  const result = await selectReleaseCandidates({
    eventName: "push",
    eventCommit: fixture.commit,
    releaseTag: "",
    ...adapters,
  })
  assert.deepEqual(result.packages, [])
  assert.deepEqual(adapters.releaseLookups, [])
})

test("dispatch uses its explicit release tag commit and includes sibling releases at that commit", async () => {
  const tags = Object.fromEntries([
    "okf-minisearch-v2.3.0",
    "pi-okf-search-v0.5.0",
  ].map((tag) => [tag, fixture.commit]))
  const releases = Object.fromEntries(Object.keys(tags).map((tag) => [tag, release(tag)]))
  const adapters = candidateAdapters({ tags, releases })

  const result = await selectReleaseCandidates({
    eventName: "workflow_dispatch",
    eventCommit: fixture.otherCommit,
    releaseTag: "pi-okf-search-v0.5.0",
    ...adapters,
  })

  assert.equal(result.commit, fixture.commit)
  assert.deepEqual(result.packages.map(({ path }) => path), PUBLIC_PACKAGES.slice(0, 2).map(({ path }) => path))
})

test("dispatch fails closed for missing, draft, and unexpected explicit releases", async (t) => {
  await t.test("missing GitHub release", async () => {
    const adapters = candidateAdapters({ tags: { "okf-minisearch-v2.3.0": fixture.commit } })
    await assert.rejects(
      selectReleaseCandidates({
        eventName: "workflow_dispatch",
        releaseTag: "okf-minisearch-v2.3.0",
        ...adapters,
      }),
      /does not exist/,
    )
  })

  await t.test("draft GitHub release", async () => {
    const tag = "okf-minisearch-v2.3.0"
    const adapters = candidateAdapters({ tags: { [tag]: fixture.commit }, releases: { [tag]: release(tag, true) } })
    await assert.rejects(
      selectReleaseCandidates({ eventName: "workflow_dispatch", releaseTag: tag, ...adapters }),
      /is a draft/,
    )
  })

  await t.test("GitHub release response has a mismatched tag", async () => {
    const tag = "okf-minisearch-v2.3.0"
    const adapters = candidateAdapters({
      tags: { [tag]: fixture.commit },
      releases: { [tag]: release("okf-minisearch-v2.2.1") },
    })
    await assert.rejects(
      selectReleaseCandidates({ eventName: "workflow_dispatch", releaseTag: tag, ...adapters }),
      /does not match its exact tag/,
    )
  })

  await t.test("tag identity does not match commit manifest", async () => {
    const tag = "okf-minisearch-v9.9.9"
    const adapters = candidateAdapters({ tags: { [tag]: fixture.commit }, releases: { [tag]: release(tag) } })
    await assert.rejects(
      selectReleaseCandidates({ eventName: "workflow_dispatch", releaseTag: tag, ...adapters }),
      /not the expected tag/,
    )
  })
})

test("older commits may omit allowlisted packages that did not exist yet", async () => {
  const tag = "okf-minisearch-v2.3.0"
  const adapters = candidateAdapters({
    tags: { [tag]: fixture.commit },
    releases: { [tag]: release(tag) },
    manifests: { "packages/okf-minisearch": fixture.manifests["packages/okf-minisearch"] },
  })
  const result = await selectReleaseCandidates({
    eventName: "workflow_dispatch",
    releaseTag: tag,
    ...adapters,
  })
  assert.deepEqual(result.packages.map(({ path }) => path), ["packages/okf-minisearch"])
})

test("tag resolution peels lightweight and annotated tags to commits", () => {
  const cwd = mkdtempSync(join(tmpdir(), "release-tags-"))
  execFileSync("git", ["init", "--quiet"], { cwd })
  execFileSync("git", ["config", "user.email", "release-test@example.com"], { cwd })
  execFileSync("git", ["config", "user.name", "Release Test"], { cwd })
  execFileSync("git", ["commit", "--quiet", "--allow-empty", "-m", "fixture"], { cwd })
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim()
  execFileSync("git", ["tag", "lightweight"], { cwd })
  execFileSync("git", ["tag", "-a", "annotated", "-m", "fixture tag"], { cwd })

  assert.equal(resolveTagCommit("lightweight", cwd), commit)
  assert.equal(resolveTagCommit("annotated", cwd), commit)
})

for (const scenario of fixture.registry) {
  test(`npm registry: ${scenario.label}`, async () => {
    const fetchImpl = async (url, options) => {
      assert.equal(url, `${NPM_REGISTRY}/okf-minisearch/2.3.0`)
      assert.equal(options.redirect, "error")
      return { status: scenario.status, json: async () => scenario.body }
    }
    if (scenario.error) {
      await assert.rejects(exactPackageState("okf-minisearch", "2.3.0", fetchImpl), new RegExp(scenario.error))
    } else {
      assert.equal(await exactPackageState("okf-minisearch", "2.3.0", fetchImpl), scenario.state)
    }
  })
}

test("npm registry malformed JSON and network failures are fatal", async (t) => {
  await t.test("malformed JSON", async () => {
    await assert.rejects(
      exactPackageState("okf-minisearch", "2.3.0", async () => ({
        status: 200,
        json: async () => { throw new SyntaxError("bad JSON") },
      })),
      /malformed JSON/,
    )
  })
  await t.test("network failure", async () => {
    await assert.rejects(
      exactPackageState("okf-minisearch", "2.3.0", async () => { throw new Error("offline") }),
      /failed: offline/,
    )
  })
})
