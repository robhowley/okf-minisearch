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
import { exactPackageState, NPM_REGISTRY } from "./npm-registry-state.mjs"
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

function publicationFixture() {
  const bytes = Buffer.from("exact registry candidate bytes")
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`
  const candidate = {
    schemaVersion: 1,
    name: "okf-search-native",
    version: "0.1.0",
    releaseCommit,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    integrity,
    compressedBytes: bytes.length,
    unpackedBytes: 100,
    files: [...NATIVE_PACKAGE_FILES],
  }
  const attestationUrl = `${NPM_REGISTRY}/-/npm/v1/attestations/okf-search-native@0.1.0`
  const tarballUrl = `${NPM_REGISTRY}/okf-search-native/-/okf-search-native-0.1.0.tgz`
  const payload = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{
      name: "pkg:npm/okf-search-native@0.1.0",
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
    if (url === `${NPM_REGISTRY}/okf-search-native`) {
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

test("release workflow proves ordered same-byte native publication and resumability", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release-please.yml", import.meta.url), "utf8")
  const candidate = workflow.slice(workflow.indexOf("  native_candidate:"), workflow.indexOf("  native_candidate_test:"))
  const candidateTest = workflow.slice(workflow.indexOf("  native_candidate_test:"), workflow.indexOf("  publication_approval:"))
  const approval = workflow.slice(workflow.indexOf("  publication_approval:"), workflow.indexOf("  publication_plan:"))
  const plan = workflow.slice(workflow.indexOf("  publication_plan:"), workflow.indexOf("  publish:"))
  const publish = workflow.slice(workflow.indexOf("  publish:"), workflow.indexOf("  native_registry_proof:"))
  const post = workflow.slice(workflow.indexOf("  native_post_publish_test:"))

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
  assert.match(candidateTest, /verify-native-consumer\.mjs/)
  assert.match(approval, /environment: npm-production/)
  assert.match(approval, /id-token: write/)
  assert.match(approval, /audience=npm:registry\.npmjs\.org/)
  assert.match(plan, /preflight all versions before mutation/)
  assert.match(plan, /npm-registry-state\.mjs/)
  assert.doesNotMatch(publish, /(?:npm|pnpm) pack|napi build|cargo build/)
  assert.match(publish, /npm publish "\$tarball" --access public --provenance/)
  assert.match(publish, /Skipping exact version already on npm/)
  assert.match(workflow, /verify-npm-publication\.mjs/)
  assert.match(post, /fail-fast: false/)
  assert.equal((post.match(/target: /g) ?? []).length, 4)
  assert.match(post, /"okf-search-native@\$version"/)
  assert.match(post, /verify-native-consumer\.mjs/)
})

test("shared consumer always installs outside the workspace with scripts disabled", () => {
  const consumer = readFileSync(new URL("./verify-native-consumer.mjs", import.meta.url), "utf8")
  assert.match(consumer, /mkdtemp\(join\(tmpdir\(\)/)
  assert.match(consumer, /"--ignore-scripts"/)
  assert.match(consumer, /root\.mjs/)
  assert.match(consumer, /root\.cjs/)
  assert.match(consumer, /types\.mts/)
  assert.match(consumer, /types\.cts/)
  assert.match(consumer, /prepared\.mjs/)
  assert.match(consumer, /openOkf/)
})
