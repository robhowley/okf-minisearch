#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const JS_PACKAGES = new Set(["okf-minisearch", "pi-okf-search"])

function fail(message) {
  throw new Error(message)
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) fail(`${command} ${args.join(" ")} exited with ${result.status}`)
}

export async function runConsumerEntry(root, filename, source, env = process.env) {
  const entry = join(root, filename)
  await writeFile(entry, source)
  run(process.execPath, [entry], root, env)
}

const searchSmokeEntry = `
import assert from "node:assert/strict"
import * as api from "okf-minisearch"

assert.deepEqual(Object.keys(api).sort(), ["OkfError", "createOkfSearch", "openOkf", "validateOkfDocument"])
const index = api.createOkfSearch([{
  path: "release.md",
  markdown: "---\\ntype: release\\n---\\nexact-version-js-smoke\\n",
}])
assert.equal(index.search("exact-version-js-smoke")[0]?.documentId, "release")
`

async function searchSmoke(root) {
  await runConsumerEntry(root, "minisearch-smoke.mjs", searchSmokeEntry)
}

async function piSmoke(root, packageRoot) {
  const agentDir = join(root, "agent")
  const fixtureDir = join(root, "fixture")
  await mkdir(agentDir)
  await mkdir(fixtureDir)
  await writeFile(join(fixtureDir, "marker.md"), "---\ntype: note\ntitle: Registry smoke\n---\nexact-version-pi-smoke\n")
  await writeFile(join(agentDir, "settings.json"), `${JSON.stringify({
    packages: [packageRoot],
    "pi-okf-search": { root: "../fixture" },
  }, null, 2)}\n`)

  await runConsumerEntry(root, "pi-smoke.mjs", `
import assert from "node:assert/strict"
import { createOkfSearch } from "okf-minisearch"
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent"

const index = createOkfSearch([{
  path: "release.md",
  markdown: "---\\ntype: release\\n---\\nexact-version-js-smoke\\n",
}])
assert.equal(index.search("exact-version-js-smoke")[0]?.documentId, "release")

const root = process.cwd()
const agentDir = process.env.PI_CODING_AGENT_DIR
const settingsManager = SettingsManager.create(root, agentDir)
const loader = new DefaultResourceLoader({
  cwd: root,
  agentDir,
  settingsManager,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
})
await loader.reload()
const loaded = loader.getExtensions()
assert.deepEqual(loaded.errors, [])
assert.equal(loaded.extensions.length, 1)
const tool = loaded.extensions[0].tools.get("okf_search")
assert.ok(tool)
const context = {
  cwd: root,
  mode: "json",
  hasUI: false,
  isProjectTrusted: () => true,
  ui: { notify() {} },
}
const handlers = loaded.extensions[0].handlers.get("session_start") ?? []
assert.equal(handlers.length, 1)
await handlers[0]({ type: "session_start", reason: "startup" }, context)
const result = await tool.definition.execute("registry-smoke", { query: "exact-version-pi-smoke" }, undefined, undefined, context)
assert.match(result.content.map(({ text }) => text ?? "").join("\\n"), /Registry smoke/)
`, { ...process.env, PI_CODING_AGENT_DIR: agentDir })
}

async function main() {
  const [name, version, ...extra] = process.argv.slice(2)
  if (extra.length || !JS_PACKAGES.has(name) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
    fail("usage: verify-js-consumer.mjs <okf-minisearch|pi-okf-search> <exact-version>")
  }

  const root = await mkdtemp(join(tmpdir(), "okf-js-release-consumer-"))
  try {
    await writeFile(join(root, "package.json"), `${JSON.stringify({
      name: "okf-js-release-consumer",
      version: "1.0.0",
      private: true,
      type: "module",
    }, null, 2)}\n`)
    const npm = process.platform === "win32" ? "npm.cmd" : "npm"
    run(npm, [
      "install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock",
      "--registry", "https://registry.npmjs.org", "--save-exact", `${name}@${version}`,
    ], root)

    const packageRoot = join(root, "node_modules", name)
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"))
    if (manifest.name !== name || manifest.version !== version) fail("installed package identity mismatch")

    if (name === "okf-minisearch") {
      await searchSmoke(root)
    } else {
      if (JSON.stringify(manifest.pi) !== JSON.stringify({ extensions: ["./extensions/okf-search"] })) {
        fail("Pi extension manifest mismatch")
      }
      for (const file of ["index.ts", "runtime.ts", "config.ts"]) {
        if (!(await stat(join(packageRoot, "extensions", "okf-search", file))).isFile()) fail(`missing Pi extension file: ${file}`)
      }
      if (typeof manifest.dependencies?.["okf-minisearch"] !== "string") fail("missing okf-minisearch dependency")
      await piSmoke(root, packageRoot)
    }

    console.log(`verified clean scripts-disabled JS consumer for ${name}@${version}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
