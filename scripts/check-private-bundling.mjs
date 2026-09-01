import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";

import { build } from "esbuild";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const privateSource = join(repoRoot, "packages", "okf-prepare", "src", "index.ts");
const privateSpecifier = "@okf-internal/prepare";
const expectedExports = ["createPrepareBundleSentinel"];
const targets = {
  minisearch: {
    entrypoint: join(
      repoRoot,
      "packages",
      "okf-minisearch",
      "test",
      "support",
      "prepare-bundle-entry.ts",
    ),
    artifacts: [
      { name: "node", platform: "node", format: "esm", target: "node20", extension: "mjs" },
      { name: "browser", platform: "browser", format: "esm", target: "es2022", extension: "mjs" },
      { name: "browser-global", platform: "browser", format: "iife", target: "es2022", extension: "js", globalName: "OkfPrepareBundleProof", minify: true },
    ],
  },
  native: {
    entrypoint: join(
      repoRoot,
      "packages",
      "okf-search-native",
      "tests",
      "prepare-bundle-entry.ts",
    ),
    artifacts: [
      { name: "native", platform: "node", format: "esm", target: "node22", extension: "mjs" },
      { name: "native", platform: "node", format: "cjs", target: "node22", extension: "cjs" },
    ],
  },
};

const targetName = process.argv[2];
const selected = targets[targetName];
assert.ok(selected, "usage: node scripts/check-private-bundling.mjs <minisearch|native>");
assert.equal(process.argv.length, 3, "the bundling proof accepts exactly one target");

function assertSentinel(api, label) {
  assert.deepEqual(Object.keys(api).sort(), expectedExports, `${label}: unexpected exports`);
  const sentinel = api.createPrepareBundleSentinel();
  assert.equal(sentinel.marker, "okf-prepare-bundled", `${label}: wrong marker`);
  assert.equal(sentinel.value, 73, `${label}: wrong value`);
}

function assertNoPrivateReference(contents, label) {
  assert.equal(contents.includes(privateSpecifier), false, `${label}: private package specifier leaked`);
  assert.equal(contents.includes("workspace:"), false, `${label}: workspace protocol leaked`);
}

async function assertPrivateBytes(metafile, label) {
  const expectedPath = await realpath(privateSource);
  let privateInput;

  for (const input of Object.keys(metafile.inputs)) {
    const inputPath = resolve(repoRoot, input);
    try {
      if (await realpath(inputPath) === expectedPath) {
        privateInput = input;
        break;
      }
    } catch {
      // Ignore virtual inputs.
    }
  }

  assert.ok(privateInput, `${label}: private source is absent from the esbuild metafile`);
  const bytes = Object.values(metafile.outputs).reduce(
    (total, output) => total + (output.inputs[privateInput]?.bytesInOutput ?? 0),
    0,
  );
  assert.ok(bytes > 0, `${label}: private source contributed no emitted bytes`);
}

async function buildJavaScript(temporaryRoot, artifact) {
  const output = join(
    temporaryRoot,
    `${artifact.name}-${artifact.format}.${artifact.extension}`,
  );
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [selected.entrypoint],
    outfile: output,
    bundle: true,
    packages: "bundle",
    metafile: true,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
    platform: artifact.platform,
    format: artifact.format,
    target: artifact.target,
    globalName: artifact.globalName,
    banner: artifact.platform === "node" && artifact.format === "esm"
      ? {
          js: 'import { createRequire as __okfCreateRequire } from "node:module";\nconst require = __okfCreateRequire(import.meta.url);',
        }
      : undefined,
    minify: artifact.minify ?? false,
  });

  const label = `${targetName} ${artifact.name} ${artifact.format}`;
  await assertPrivateBytes(result.metafile, label);
  const code = await readFile(output, "utf8");
  assertNoPrivateReference(code, label);

  if (artifact.format === "iife") {
    const context = {};
    runInNewContext(code, context);
    assertSentinel(context.OkfPrepareBundleProof, label);
  } else if (artifact.format === "cjs") {
    assertSentinel(createRequire(import.meta.url)(output), label);
  } else {
    assertSentinel(await import(pathToFileURL(output).href), label);
  }
}

async function buildDeclarations(temporaryRoot) {
  const output = join(temporaryRoot, `${targetName}.d.ts`);
  const bundle = await rollup({
    input: selected.entrypoint,
    plugins: [
      {
        name: "resolve-private-prepare-source",
        resolveId(id) {
          return id === privateSpecifier ? privateSource : null;
        },
      },
      dts({ respectExternal: false }),
    ],
    onwarn(warning) {
      throw new Error(`Rollup warning: ${warning.message}`);
    },
  });

  try {
    await bundle.write({ file: output, format: "es" });
  } finally {
    await bundle.close();
  }

  const declaration = await readFile(output, "utf8");
  assert.match(declaration, /createPrepareBundleSentinel/);
  assert.match(declaration, /readonly marker: ["']okf-prepare-bundled["']/);
  assert.match(declaration, /readonly value: 73/);
  assertNoPrivateReference(declaration, `${targetName} declarations`);

  const consumerRoot = await mkdtemp(join(tmpdir(), "okf-prepare-declaration-consumer-"));
  try {
    const packageRoot = join(consumerRoot, "node_modules", "prepare-bundle-proof");
    await mkdir(packageRoot, { recursive: true });
    await copyFile(output, join(packageRoot, "index.d.ts"));
    await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
      name: "prepare-bundle-proof",
      private: true,
      type: "module",
      types: "./index.d.ts",
    }, null, 2)}\n`);
    await writeFile(join(consumerRoot, "consumer.ts"), `import { createPrepareBundleSentinel } from "prepare-bundle-proof";\nconst sentinel = createPrepareBundleSentinel();\nconst marker: "okf-prepare-bundled" = sentinel.marker;\nconst value: 73 = sentinel.value;\nvoid [marker, value];\n`);
    await writeFile(join(consumerRoot, "tsconfig.json"), `${JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: [],
      },
      include: ["consumer.ts"],
    }, null, 2)}\n`);

    assert.throws(
      () => createRequire(join(consumerRoot, "probe.cjs")).resolve(privateSpecifier),
      (error) => error?.code === "MODULE_NOT_FOUND",
      "the declaration consumer unexpectedly resolves the private package",
    );
    const tsc = join(repoRoot, "node_modules", "typescript", "bin", "tsc");
    const result = spawnSync(
      process.execPath,
      [tsc, "--project", "tsconfig.json", "--pretty", "false"],
      { cwd: consumerRoot, encoding: "utf8" },
    );
    assert.equal(
      result.status,
      0,
      `declaration consumer failed to compile:\n${result.stdout}${result.stderr}`,
    );
  } finally {
    await rm(consumerRoot, { recursive: true, force: true });
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "okf-prepare-bundle-"));
try {
  for (const artifact of selected.artifacts) {
    await buildJavaScript(temporaryRoot, artifact);
  }
  await buildDeclarations(temporaryRoot);
  console.log(`${targetName}: private JS and declaration bundling proof passed`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
