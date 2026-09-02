import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflows = {
  source: {
    path: join(packageRoot, "..", "..", ".github", "workflows", "ci.yml"),
    job: "native-artifacts",
  },
  release: {
    path: join(packageRoot, "..", "..", ".github", "workflows", "release-please.yml"),
    job: "native_release_build",
  },
};

const expectedRows = [
  {
    runner: "ubuntu-latest",
    target: "x86_64-unknown-linux-gnu",
    "node-arch": "x64",
    artifact: "okf-search-native.linux-x64-gnu.node",
    "napi-cross": true,
    "macos-deployment-target": "",
  },
  {
    runner: "macos-latest",
    target: "x86_64-apple-darwin",
    "node-arch": "x64",
    artifact: "okf-search-native.darwin-x64.node",
    "napi-cross": false,
    "macos-deployment-target": "10.13",
  },
  {
    runner: "macos-latest",
    target: "aarch64-apple-darwin",
    "node-arch": "arm64",
    artifact: "okf-search-native.darwin-arm64.node",
    "napi-cross": false,
    "macos-deployment-target": "10.13",
  },
  {
    runner: "windows-latest",
    target: "x86_64-pc-windows-msvc",
    "node-arch": "x64",
    artifact: "okf-search-native.win32-x64-msvc.node",
    "napi-cross": false,
    "macos-deployment-target": "",
  },
];

async function parseWorkflow(path) {
  const ruby = "print JSON.generate(YAML.safe_load(File.read(ARGV[0]), aliases: true))";
  const { stdout } = await execFileAsync("ruby", ["-r", "yaml", "-r", "json", "-e", ruby, path]);
  return JSON.parse(stdout);
}

for (const [label, spec] of Object.entries(workflows)) {
  test(`${label} native matrix binds Node and dependency installation to all four target CPUs`, async () => {
    const workflow = await parseWorkflow(spec.path);
    const job = workflow.jobs[spec.job];
    assert.deepEqual(job.strategy.matrix.include, expectedRows);
    const setup = job.steps.find(({ name }) => name === "Setup Node.js");
    assert.equal(setup.with.architecture, "${{ matrix.node-arch }}");
    const install = job.steps.find(({ run }) => run?.startsWith("pnpm install --frozen-lockfile"));
    assert.equal(install.run, "pnpm install --frozen-lockfile --cpu=${{ matrix.node-arch }}");
  });
}

test("native workflows preserve build, runtime, GLIBC, and upload gates", async () => {
  for (const { path, job } of Object.values(workflows)) {
    const source = await readFile(path, "utf8");
    const parsed = await parseWorkflow(path);
    const commands = parsed.jobs[job].steps.map(({ run }) => run ?? "").join("\n");
    assert.match(commands, /--platform --release --js native\.cjs --dts native\.d\.cts/);
    assert.match(commands, /-- --locked/);
    assert.match(commands, /--use-napi-cross/);
    assert.match(commands, /GLIBC_2\.17/);
    assert.ok(source.includes('${build_args[@]+"${build_args[@]}"}'));
    assert.ok(parsed.jobs[job].steps.findIndex(({ name }) => name.startsWith("Runtime smoke")) < parsed.jobs[job].steps.findIndex(({ name }) => name === "Upload tested artifact"));
  }
});
