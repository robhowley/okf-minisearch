import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import {
  PUBLIC_PACKAGES,
  resolveTagCommit,
  selectReleaseCandidates,
} from "./release-candidates.mjs"
import {
  compareSemver,
  exactPackageState,
  NPM_REGISTRY,
  packagePublicationPolicy,
} from "./npm-registry-state.mjs"
import {
  inspectPublicationArtifact,
  verifyPublicationPlan,
} from "./release-publication-plan.mjs"
import {
  COMPRESSED_LIMIT,
  NATIVE_PACKAGE_FILES,
  UNPACKED_LIMIT,
  inspectReleaseCandidate,
  verifyReleaseCandidate,
} from "./verify-release-candidate.mjs"
import {
  PROVENANCE_PREDICATE,
  verifyNpmPublication,
} from "./verify-npm-publication.mjs"
import { runConsumerEntry } from "./verify-js-consumer.mjs"

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

test("registry publication policy cannot move latest backward", async (t) => {
  const policyFetch = (packument) => async (url, options) => {
    assert.equal(url, `${NPM_REGISTRY}/okf-minisearch`)
    assert.equal(options.redirect, "error")
    return { status: 200, json: async () => packument }
  }
  const packument = (latest, versions = {}) => ({
    name: "okf-minisearch",
    "dist-tags": { latest },
    versions,
  })

  assert.ok(compareSemver("2.4.0", "2.3.0") > 0)
  assert.ok(compareSemver("2.3.0", "2.3.0-beta.1") > 0)
  assert.ok(compareSemver("2.3.0-beta.2", "2.3.0-beta.1") > 0)

  await t.test("an unpublished upgrade explicitly uses latest", async () => {
    assert.deepEqual(
      await packagePublicationPolicy("okf-minisearch", "2.3.0", policyFetch(packument("2.2.1"))),
      { state: "unpublished", distTag: "latest" },
    )
  })
  await t.test("an unpublished historical version fails before mutation", async () => {
    await assert.rejects(
      packagePublicationPolicy("okf-minisearch", "2.3.0", policyFetch(packument("2.4.0"))),
      /latest is newer/,
    )
  })
  await t.test("an already-published historical version has explicit no-tag proof", async () => {
    assert.deepEqual(
      await packagePublicationPolicy("okf-minisearch", "2.3.0", policyFetch(packument("2.4.0", {
        "2.3.0": { name: "okf-minisearch", version: "2.3.0" },
      }))),
      { state: "published", distTag: null },
    )
  })
  await t.test("an already-published current version still proves latest", async () => {
    assert.deepEqual(
      await packagePublicationPolicy("okf-minisearch", "2.3.0", policyFetch(packument("2.3.0", {
        "2.3.0": { name: "okf-minisearch", version: "2.3.0" },
      }))),
      { state: "published", distTag: "latest" },
    )
  })
})

function nativeManifest() {
  return {
    name: "okf-search-native",
    version: "0.1.0",
    description: "fixture",
    main: "./dist/index.cjs",
    module: "./dist/index.mjs",
    types: "./dist/index.d.ts",
    exports: {
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
    },
    files: ["dist", "native.cjs", "native.d.cts", "okf-search-native.*.node"],
    scripts: { test: "node --test" },
    devDependencies: { typescript: "1.0.0" },
    engines: { node: ">=22.19.0" },
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/robhowley/okf-minisearch.git",
      directory: "packages/okf-search-native",
    },
    napi: {
      binaryName: "okf-search-native",
      targets: [
        "x86_64-apple-darwin",
        "aarch64-apple-darwin",
        "x86_64-pc-windows-msvc",
        "x86_64-unknown-linux-gnu",
      ],
    },
  }
}

function candidateTarball({ omit, manifest = nativeManifest() } = {}) {
  const root = mkdtempSync(join(tmpdir(), "native-candidate-fixture-"))
  const packageRoot = join(root, "package")
  mkdirSync(packageRoot, { recursive: true })
  for (const file of NATIVE_PACKAGE_FILES) {
    if (file === omit) continue
    const path = join(packageRoot, file)
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, file === "package.json" ? JSON.stringify(manifest) : `fixture:${file}`)
  }
  const tarball = join(root, "candidate.tgz")
  execFileSync("tar", ["-czf", tarball, "package"], { cwd: root })
  return { root, tarball }
}

const releaseCommit = "a".repeat(40)

test("candidate metadata records exact bytes, sizes, files, identity, and release commit", async () => {
  const fixture = candidateTarball()
  try {
    const metadata = await inspectReleaseCandidate(fixture.tarball, releaseCommit)
    assert.equal(metadata.schemaVersion, 1)
    assert.equal(metadata.name, "okf-search-native")
    assert.equal(metadata.version, "0.1.0")
    assert.equal(metadata.releaseCommit, releaseCommit)
    assert.match(metadata.sha256, /^[0-9a-f]{64}$/)
    assert.match(metadata.integrity, /^sha512-/)
    assert.ok(metadata.compressedBytes <= COMPRESSED_LIMIT)
    assert.ok(metadata.unpackedBytes <= UNPACKED_LIMIT)
    assert.deepEqual(metadata.files, [...NATIVE_PACKAGE_FILES])
    assert.deepEqual(await verifyReleaseCandidate(fixture.tarball, metadata), metadata)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("candidate verification fails closed for files, ceilings, metadata, and commit", async (t) => {
  await t.test("missing exact file", async () => {
    const fixture = candidateTarball({ omit: "dist/index.mjs" })
    try {
      await assert.rejects(inspectReleaseCandidate(fixture.tarball, releaseCommit), /exact release package/)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
  await t.test("fixed compressed ceiling", async () => {
    const fixture = candidateTarball()
    try {
      await assert.rejects(inspectReleaseCandidate(fixture.tarball, releaseCommit, { compressedLimit: 1 }), /compressed bytes/)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
  await t.test("fixed unpacked ceiling", async () => {
    const fixture = candidateTarball()
    try {
      await assert.rejects(inspectReleaseCandidate(fixture.tarball, releaseCommit, { unpackedLimit: 1 }), /unpacked bytes/)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
  await t.test("wrong public repository metadata", async () => {
    const manifest = nativeManifest()
    manifest.repository.directory = "packages/wrong"
    const fixture = candidateTarball({ manifest })
    try {
      await assert.rejects(inspectReleaseCandidate(fixture.tarball, releaseCommit), /candidate repository metadata/)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
  await t.test("changed metadata and release commit", async () => {
    const fixture = candidateTarball()
    try {
      const metadata = await inspectReleaseCandidate(fixture.tarball, releaseCommit)
      await assert.rejects(verifyReleaseCandidate(fixture.tarball, { ...metadata, sha256: "0".repeat(64) }), /changed/)
      await assert.rejects(verifyReleaseCandidate(fixture.tarball, metadata, "b".repeat(40)), /commit does not match/)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })
})

test("publication plan records and re-verifies every immutable artifact", async () => {
  const fixture = candidateTarball()
  try {
    const artifact = await inspectPublicationArtifact(
      fixture.tarball,
      "packages/okf-search-native",
      "okf-search-native",
      "0.1.0",
      releaseCommit,
    )
    const entry = { ...artifact, preflightState: "unpublished", distTag: "latest" }
    assert.match(entry.sha256, /^[0-9a-f]{64}$/)
    assert.match(entry.integrity, /^sha512-/)
    assert.ok(entry.compressedBytes > 0)
    assert.ok(entry.unpackedBytes > 0)
    assert.equal(entry.sourceCommit, releaseCommit)
    assert.deepEqual(await verifyPublicationPlan(fixture.root, [entry], releaseCommit), [entry])

    writeFileSync(fixture.tarball, "changed approved bytes")
    await assert.rejects(verifyPublicationPlan(fixture.root, [entry], releaseCommit))
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

function publicationFixture({ name = "okf-search-native", version = "0.1.0" } = {}) {
  const bytes = Buffer.from("exact registry candidate bytes")
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`
  const candidate = {
    schemaVersion: 1,
    name,
    version,
    releaseCommit,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    integrity,
    compressedBytes: bytes.length,
    unpackedBytes: 100,
    files: [...NATIVE_PACKAGE_FILES],
  }
  const attestationUrl = `${NPM_REGISTRY}/-/npm/v1/attestations/${name}@${version}`
  const tarballUrl = `${NPM_REGISTRY}/${name}/-/${name}-${version}.tgz`
  const payload = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{
      name: `pkg:npm/${name}@${version}`,
      digest: { sha512: Buffer.from(integrity.slice(7), "base64").toString("hex") },
    }],
    predicateType: PROVENANCE_PREDICATE,
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            ref: "refs/heads/main",
            repository: "https://github.com/robhowley/okf-minisearch",
            path: ".github/workflows/release-please.yml",
          },
        },
        resolvedDependencies: [{
          uri: "git+https://github.com/robhowley/okf-minisearch@refs/heads/main",
          digest: { gitCommit: releaseCommit },
        }],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: { invocationId: "https://github.com/robhowley/okf-minisearch/actions/runs/123/attempts/1" },
      },
    },
  }
  const provenance = {
    predicateType: PROVENANCE_PREDICATE,
    bundle: {
      mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
      verificationMaterial: {
        certificate: { rawBytes: "Y2VydA==" },
        tlogEntries: [{}],
      },
      dsseEnvelope: {
        payloadType: "application/vnd.in-toto+json",
        payload: Buffer.from(JSON.stringify(payload)).toString("base64"),
        signatures: [{ sig: "signed" }],
      },
    },
  }
  const packument = {
    name: candidate.name,
    maintainers: [{ name: "robhowley" }],
    "dist-tags": { latest: candidate.version },
    versions: {
      [candidate.version]: {
        name: candidate.name,
        version: candidate.version,
        dist: {
          integrity,
          tarball: tarballUrl,
          attestations: {
            url: attestationUrl,
            provenance: { predicateType: PROVENANCE_PREDICATE },
          },
        },
      },
    },
  }
  return { bytes, candidate, attestationUrl, tarballUrl, payload, provenance, packument }
}

function publicationFetch(data) {
  return async (url, options) => {
    assert.equal(options.redirect, "error")
    if (url === `${NPM_REGISTRY}/${data.candidate.name}`) {
      return { status: 200, json: async () => data.packument }
    }
    if (url === data.tarballUrl) {
      return { status: 200, arrayBuffer: async () => data.bytes }
    }
    if (url === data.attestationUrl) {
      return { status: 200, json: async () => ({ attestations: [data.provenance] }) }
    }
    throw new Error(`unexpected URL ${url}`)
  }
}

const publicationOptions = {
  owner: "robhowley",
  repository: "https://github.com/robhowley/okf-minisearch",
  workflow: ".github/workflows/release-please.yml",
}

test("registry proof matches owner, exact tag/version, bytes, SRI, workflow, and commit", async () => {
  const data = publicationFixture()
  assert.deepEqual(
    await verifyNpmPublication(data.candidate, { ...publicationOptions, fetchImpl: publicationFetch(data) }),
    { name: "okf-search-native", version: "0.1.0", sha256: data.candidate.sha256 },
  )
})

test("registry proof applies to selected JavaScript packages", async () => {
  const data = publicationFixture({ name: "okf-minisearch", version: "2.3.0" })
  assert.deepEqual(
    await verifyNpmPublication(data.candidate, { ...publicationOptions, fetchImpl: publicationFetch(data) }),
    { name: "okf-minisearch", version: "2.3.0", sha256: data.candidate.sha256 },
  )
})

test("historical registry proof follows explicit no-dist-tag policy", async () => {
  const data = publicationFixture()
  data.packument["dist-tags"].latest = "0.2.0"
  data.candidate.sourceCommit = data.candidate.releaseCommit
  delete data.candidate.releaseCommit
  assert.deepEqual(
    await verifyNpmPublication(data.candidate, {
      ...publicationOptions,
      distTag: null,
      fetchImpl: publicationFetch(data),
    }),
    { name: "okf-search-native", version: "0.1.0", sha256: data.candidate.sha256 },
  )
})

test("registry and provenance verification fail closed", async (t) => {
  for (const [label, mutate, pattern] of [
    ["owner", (data) => { data.packument.maintainers = [{ name: "other" }] }, /owner/],
    ["dist-tag", (data) => { data.packument["dist-tags"].latest = "0.0.9" }, /dist-tag/],
    ["registry bytes", (data) => { data.bytes = Buffer.from("different") }, /SHA-256/],
    ["integrity", (data) => { data.packument.versions["0.1.0"].dist.integrity = `sha512-${"A".repeat(86)}==` }, /integrity/],
    ["unsupported schema", (data) => { data.provenance.bundle.mediaType = "application/unknown" }, /unsupported provenance bundle schema/],
    ["missing signature", (data) => { data.provenance.bundle.dsseEnvelope.signatures = [] }, /signature/],
    ["workflow identity", (data) => { data.payload.predicate.buildDefinition.externalParameters.workflow.path = ".github/workflows/other.yml" }, /workflow identity/],
    ["release commit", (data) => { data.payload.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "b".repeat(40) }, /release commit/],
  ]) {
    await t.test(label, async () => {
      const data = publicationFixture()
      mutate(data)
      if (label === "workflow identity" || label === "release commit") {
        data.provenance.bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(data.payload)).toString("base64")
      }
      await assert.rejects(
        verifyNpmPublication(data.candidate, { ...publicationOptions, fetchImpl: publicationFetch(data) }),
        pattern,
      )
    })
  }
})

test("mixed recovery blocks unpublished publication when a skipped proof is bad", async (t) => {
  for (const [label, mutate, pattern] of [
    ["bytes", (data) => { data.bytes = Buffer.from("wrong skipped bytes") }, /SHA-256/],
    ["provenance", (data) => {
      data.payload.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "b".repeat(40)
      data.provenance.bundle.dsseEnvelope.payload = Buffer.from(JSON.stringify(data.payload)).toString("base64")
    }, /release commit/],
  ]) {
    await t.test(label, async () => {
      const skipped = publicationFixture({ name: "okf-minisearch", version: "2.3.0" })
      mutate(skipped)
      const plan = [
        { ...skipped.candidate, preflightState: "published" },
        { name: "pi-okf-search", version: "0.5.0", preflightState: "unpublished" },
      ]
      let publicationLoopEntered = false
      const recover = async () => {
        for (const entry of plan.filter(({ preflightState }) => preflightState === "published")) {
          await verifyNpmPublication(entry, { ...publicationOptions, fetchImpl: publicationFetch(skipped) })
        }
        publicationLoopEntered = true
      }

      await assert.rejects(recover(), pattern)
      assert.equal(publicationLoopEntered, false)
    })
  }
})

function workflowJob(workflow, name, nextName) {
  const start = workflow.indexOf(`  ${name}:`)
  const end = nextName ? workflow.indexOf(`  ${nextName}:`, start) : workflow.length
  assert.ok(start >= 0 && end > start, `missing workflow job ${name}`)
  return workflow.slice(start, end)
}

function jobNeeds(job) {
  const match = job.match(/^    needs: (.+)$/m)
  if (!match) return []
  return match[1].startsWith("[")
    ? match[1].slice(1, -1).split(",").map((value) => value.trim())
    : [match[1].trim()]
}

test("release workflow has exact approval, publication, and proof dataflow", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release-please.yml", import.meta.url), "utf8")
  const order = [
    "release_please", "release_metadata", "native_release_build", "native_candidate",
    "native_candidate_test", "publication_plan", "publication_approval", "publish",
    "registry_proof", "js_post_publish_test", "native_post_publish_test",
  ]
  const jobs = Object.fromEntries(order.map((name, index) => [
    name,
    workflowJob(workflow, name, order[index + 1]),
  ]))
  assert.deepEqual(Object.fromEntries(order.map((name) => [name, jobNeeds(jobs[name])])), {
    release_please: [],
    release_metadata: ["release_please"],
    native_release_build: ["release_metadata"],
    native_candidate: ["release_metadata", "native_release_build"],
    native_candidate_test: ["release_metadata", "native_candidate"],
    publication_plan: ["release_metadata", "native_candidate", "native_candidate_test"],
    publication_approval: ["release_metadata", "publication_plan"],
    publish: ["release_metadata", "publication_plan", "publication_approval"],
    registry_proof: ["release_metadata", "publication_plan", "publish"],
    js_post_publish_test: ["release_metadata", "publication_plan", "registry_proof"],
    native_post_publish_test: ["release_metadata", "publication_plan", "registry_proof"],
  })

  const candidate = jobs.native_candidate
  const candidateTest = jobs.native_candidate_test
  const plan = jobs.publication_plan
  const approval = jobs.publication_approval
  const publish = jobs.publish
  const proof = jobs.registry_proof
  const jsPost = jobs.js_post_publish_test
  const nativePost = jobs.native_post_publish_test

  assert.match(workflow, /--platform --release --js native\.cjs --dts native\.d\.cts/)
  assert.match(workflow, /-- --locked/)
  assert.match(workflow, /--use-napi-cross/)
  assert.match(workflow, /MACOSX_DEPLOYMENT_TARGET/)
  assert.match(workflow, /GLIBC_2\.17/)
  assert.ok(workflow.indexOf("Runtime smoke root and prepared") < workflow.indexOf("Upload tested artifact"))
  assert.match(candidate, /find packages\/okf-search-native[^\n]+-name '\*\.node' -delete/)
  assert.match(candidate, /rm -rf packages\/okf-search-native\/npm/)
  assert.match(candidate, /napi create-npm-dirs --npm-dir npm/)
  assert.match(candidate, /napi artifacts/)
  assert.equal((candidate.match(/pnpm pack/g) ?? []).length, 1)
  assert.match(candidate, /verify-release-candidate\.mjs create/)
  assert.match(candidateTest, /fail-fast: false/)
  assert.equal((candidateTest.match(/target: /g) ?? []).length, 4)
  assert.ok(candidateTest.indexOf("Verify candidate digest before install") < candidateTest.indexOf("Test scripts-disabled"))

  assert.match(plan, /Build and test selected JavaScript packages/)
  assert.match(plan, /pnpm pack --pack-destination/)
  assert.match(plan, /release-publication-plan\.mjs inspect/)
  assert.match(plan, /"\$RELEASE_COMMIT"/)
  assert.match(plan, /Upload immutable publication plan and exact artifacts/)
  assert.match(approval, /environment: npm-production/)
  assert.match(approval, /release-publication-plan\.mjs verify/)
  assert.match(approval, /test "\$GITHUB_SHA" = "\$RELEASE_COMMIT"/)
  assert.match(approval, /test "\$GITHUB_REF" = "refs\/heads\/main"/)
  assert.match(approval, /OIDC provenance commit mismatch/)
  assert.ok(workflow.indexOf("Upload immutable publication plan and exact artifacts") < workflow.indexOf("environment: npm-production"))
  const afterApproval = workflow.slice(workflow.indexOf("  publication_approval:"))
  assert.doesNotMatch(afterApproval, /^\s+(?:npm pack|pnpm .*\b(?:pack|build)\b|napi build|cargo build)/m)

  assert.doesNotMatch(publish, /(?:npm|pnpm) pack|napi build|cargo build|build:facade/)
  const publicationLoop = publish.indexOf("- name: Publish downloaded tarballs without build or pack")
  const skippedProof = publish.indexOf("verify-npm-publication.mjs")
  const verifiedMarker = publish.indexOf("printf '%s@%s\\n'", skippedProof)
  assert.ok(publish.indexOf("release-publication-plan.mjs verify") < skippedProof)
  assert.ok(skippedProof < verifiedMarker)
  assert.ok(verifiedMarker < publicationLoop)
  assert.ok(publish.indexOf('test "$GITHUB_SHA" = "$RELEASE_COMMIT"') < publicationLoop)
  assert.ok(publish.indexOf('grep -Fx -- "$name@$version" "$verified"') > publicationLoop)
  assert.ok(publish.indexOf('grep -Fx -- "$name@$version" "$verified"') < publish.indexOf("Skipping exact version already on npm"))
  assert.match(publish, /npm publish "\$tarball" --access public --provenance --tag "\$dist_tag"/)
  assert.match(publish, /Skipping exact version already on npm/)

  assert.match(proof, /while IFS= read -r package/)
  assert.match(proof, /verify-npm-publication\.mjs/)
  assert.match(proof, /\.distTag \/\/ "-"/)
  assert.match(jsPost, /verify-js-consumer\.mjs/)
  assert.match(jsPost, /js_released_packages/)
  assert.match(nativePost, /fail-fast: false/)
  assert.equal((nativePost.match(/target: /g) ?? []).length, 4)
  assert.match(nativePost, /"okf-search-native@\$version"/)
  assert.match(nativePost, /verify-native-consumer\.mjs/)
})

test("packed native README describes the exact root and prepared boundaries", () => {
  const readme = readFileSync(new URL("../packages/okf-search-native/README.md", import.meta.url), "utf8")
  for (const name of ["OkfError", "createOkfSearch", "openOkf", "validateOkfDocument"]) {
    assert.match(readme, new RegExp(`\\b${name}\\b`))
  }
  assert.match(readme, /from "okf-search-native"/)
  assert.match(readme, /from "okf-search-native\/prepared"/)
  assert.match(readme, /NativeOkfSearch\.fromPrepared/)
  assert.match(readme, /native\.cjs/)
  assert.match(readme, /native\.d\.cts/)
  assert.match(readme, /dist\/index\.d\.ts/)
  assert.doesNotMatch(readme, /(?:npm install|npm add|pnpm add|yarn add)\s+okf-search-native/)
})

test("clean ESM consumer resolves bare package imports through root exports", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "js-consumer-exports-"))
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "js-consumer-exports-fixture",
      private: true,
      type: "module",
    }))

    for (const name of ["okf-minisearch", "@earendil-works/pi-coding-agent"]) {
      await t.test(name, async () => {
        const packageRoot = join(root, "node_modules", ...name.split("/"))
        mkdirSync(join(packageRoot, "dist"), { recursive: true })
        writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
          name,
          version: "1.0.0",
          type: "module",
          exports: { ".": { import: "./dist/index.js" } },
        }))
        writeFileSync(join(packageRoot, "dist", "index.js"), "export const loaded = 'esm'\n")
        await runConsumerEntry(root, `${name.split("/").at(-1)}.mjs`, `
import assert from "node:assert/strict"
import { loaded } from "${name}"
assert.equal(loaded, "esm")
`)
      })
    }

    await t.test("a broken MiniSearch root export fails despite a loadable internal dist file", async () => {
      const packageRoot = join(root, "node_modules", "okf-minisearch")
      writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
        name: "okf-minisearch",
        version: "1.0.0",
        type: "module",
        exports: { ".": { import: "./dist/missing.js" } },
      }))
      await assert.rejects(
        runConsumerEntry(root, "broken-root.mjs", 'import "okf-minisearch"\n'),
        /exited with 1/,
      )
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("shared consumers install exact packages outside the workspace with scripts disabled", () => {
  const native = readFileSync(new URL("./verify-native-consumer.mjs", import.meta.url), "utf8")
  assert.match(native, /mkdtemp\(join\(tmpdir\(\)/)
  assert.match(native, /"--ignore-scripts"/)
  assert.match(native, /root\.mjs/)
  assert.match(native, /root\.cjs/)
  assert.match(native, /types\.mts/)
  assert.match(native, /types\.cts/)
  assert.match(native, /prepared\.mjs/)
  assert.match(native, /openOkf/)

  const javascript = readFileSync(new URL("./verify-js-consumer.mjs", import.meta.url), "utf8")
  assert.match(javascript, /mkdtemp\(join\(tmpdir\(\)/)
  assert.match(javascript, /"--ignore-scripts"/)
  assert.match(javascript, /`\$\{name\}@\$\{version\}`/)
  assert.match(javascript, /from "okf-minisearch"/)
  assert.match(javascript, /from "@earendil-works\/pi-coding-agent"/)
  assert.match(javascript, /pi-okf-search/)
  assert.doesNotMatch(javascript, /node_modules[^\n]+dist[^\n]+index\.js/)
})
