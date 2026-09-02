import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = join(packageRoot, "..", "..", ".github", "workflows", "ci.yml");

function unquote(value) {
  return value.replace(/^['"]|['"]$/g, "");
}

test("source native CI keeps the four target/artifact rows", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const rows = [...workflow.matchAll(
    /- runner: ([^\n]+)\n\s+target: ([^\n]+)\n\s+node-arch: ([^\n]+)\n\s+artifact: ([^\n]+)\n\s+napi-cross: (true|false)\n\s+macos-deployment-target: ([^\n]+)/g,
  )].map((match) => ({
    runner: match[1],
    target: match[2],
    nodeArch: match[3],
    artifact: match[4],
    napiCross: match[5],
    macosDeploymentTarget: unquote(match[6]),
  }));

  assert.deepEqual(rows, [
    {
      runner: "ubuntu-latest",
      target: "x86_64-unknown-linux-gnu",
      nodeArch: "x64",
      artifact: "okf-search-native.linux-x64-gnu.node",
      napiCross: "true",
      macosDeploymentTarget: "",
    },
    {
      runner: "macos-latest",
      target: "x86_64-apple-darwin",
      nodeArch: "x64",
      artifact: "okf-search-native.darwin-x64.node",
      napiCross: "false",
      macosDeploymentTarget: "10.13",
    },
    {
      runner: "macos-latest",
      target: "aarch64-apple-darwin",
      nodeArch: "arm64",
      artifact: "okf-search-native.darwin-arm64.node",
      napiCross: "false",
      macosDeploymentTarget: "10.13",
    },
    {
      runner: "windows-latest",
      target: "x86_64-pc-windows-msvc",
      nodeArch: "x64",
      artifact: "okf-search-native.win32-x64-msvc.node",
      napiCross: "false",
      macosDeploymentTarget: "",
    },
  ]);
});

test("source native CI builds and exercises the renamed package output", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /--platform --release --js native\.cjs --dts native\.d\.cts/);
  assert.match(workflow, /--target "\$\{\{ matrix\.target \}\}"/);
  assert.match(workflow, /-- --locked/);
  assert.match(workflow, /--use-napi-cross/);
  assert.match(workflow, /node-version: 22\.19\.0/);
  assert.match(workflow, /node-version: 22\.20\.0/);
  assert.match(workflow, /toolchain: 1\.88\.0/);
  assert.match(workflow, /MACOSX_DEPLOYMENT_TARGET/);
  assert.match(workflow, /macos-deployment-target: '10\.13'/);
  assert.ok(workflow.includes('${build_args[@]+"${build_args[@]}"}'));

  const facade = workflow.indexOf("- name: Build source package facade");
  const glibc = workflow.indexOf("- name: Verify Linux glibc floor");
  const smoke = workflow.indexOf("- name: Runtime smoke test");
  const upload = workflow.indexOf("- name: Upload tested artifact");
  assert.ok(facade >= 0 && facade < glibc);
  assert.ok(glibc < smoke && smoke < upload);
  assert.match(workflow, /objdump -T/);
  assert.match(workflow, /Maximum imported GLIBC symbol/);
  assert.match(workflow, /GLIBC_2\.17/);
});
