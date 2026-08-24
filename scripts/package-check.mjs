import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  join,
  relative,
} from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(root, "packages", "okf-minisearch");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function display(command, args) {
  return [command, ...args]
    .map((part) => part.includes(" ") ? JSON.stringify(part) : part)
    .join(" ");
}

function run(command, args, options = {}) {
  console.log(`\n> ${display(command, args)}`);

  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: options.capture
      ? ["ignore", "pipe", "inherit"]
      : "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${display(command, args)} exited with status ${result.status}`,
    );
  }

  return result.stdout ?? "";
}

function parsePackManifest(output, packageMetadata) {
  let manifest;

  try {
    manifest = JSON.parse(output);
  } catch {
    throw new Error("pnpm pack did not return valid JSON");
  }

  assert.equal(manifest.name, packageMetadata.name);
  assert.equal(manifest.version, packageMetadata.version);
  assert.equal(typeof manifest.filename, "string");
  assert.equal(basename(manifest.filename), manifest.filename);
  assert.ok(Array.isArray(manifest.files));

  const paths = manifest.files.map((file) => file.path).sort();
  const required = [
    "LICENSE",
    "README.md",
    "dist/index.d.ts",
    "dist/index.js",
    "package.json",
  ];

  for (const path of required) {
    assert.ok(paths.includes(path), `packed package is missing ${path}`);
  }

  const unexpected = paths.filter((path) =>
    path !== "LICENSE" &&
    path !== "README.md" &&
    path !== "package.json" &&
    !path.startsWith("dist/"));
  assert.deepEqual(
    unexpected,
    [],
    `packed package has unexpected files: ${unexpected.join(", ")}`,
  );

  const sourceFiles = paths.filter((path) =>
    path.startsWith("dist/") &&
    path.endsWith(".ts") &&
    !path.endsWith(".d.ts"));
  assert.deepEqual(
    sourceFiles,
    [],
    `packed package contains source files: ${sourceFiles.join(", ")}`,
  );

  return manifest;
}

const typeConsumer = `import {
  OkfError,
  openOkf,
} from "okf-minisearch";
import type {
  OkfDocumentInput,
  OkfErrorCode,
  OkfIngestResult,
  OkfSearch,
  OkfSearchHit,
  OkfSearchOptions,
} from "okf-minisearch";

const search: OkfSearch = await openOkf(".");
const input: OkfDocumentInput = {
  path: "consumer.md",
  markdown: "---\\ntype: note\\n---\\npackagevalidationneedle",
};
const ingestResult: OkfIngestResult = search.ingest(input);
const options: OkfSearchOptions = { limit: 1 };
const hits: OkfSearchHit[] = search.search(
  "packagevalidationneedle",
  options,
);
const code: OkfErrorCode = "ERR_OKF_FIELD";
const error = new OkfError(code, input.path, { field: "path" });

void [ingestResult, hits, error];
`;

const runtimeConsumer = `import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as api from "okf-minisearch";

assert.deepEqual(Object.keys(api).sort(), ["OkfError", "openOkf"]);

const root = await mkdtemp(join(tmpdir(), "okf-minisearch-consumer-"));

try {
  const okf = await api.openOkf(root);
  const result = okf.ingest({
    path: "consumer.md",
    markdown: "---\\ntype: note\\n---\\npackagevalidationneedle",
  });
  const hits = okf.search("packagevalidationneedle");
  const error = new api.OkfError(
    "ERR_OKF_FIELD",
    "consumer.md",
    { field: "path" },
  );

  assert.equal(result.document.id, "consumer");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].documentId, "consumer");
  assert.equal(error.code, "ERR_OKF_FIELD");
  assert.equal(error.field, "path");
} finally {
  await rm(root, { recursive: true, force: true });
}
`;

async function checkConsumer(tarball, temporaryRoot) {
  const consumerRoot = join(temporaryRoot, "consumer");
  await mkdir(consumerRoot);
  await writeFile(
    join(consumerRoot, "package.json"),
    JSON.stringify({
      name: "okf-minisearch-package-consumer",
      private: true,
      type: "module",
    }, null, 2),
  );
  await writeFile(join(consumerRoot, "consumer.mts"), typeConsumer);
  await writeFile(join(consumerRoot, "runtime.mjs"), runtimeConsumer);
  await writeFile(
    join(consumerRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: ["node"],
        typeRoots: [join(root, "node_modules", "@types")],
      },
      include: ["consumer.mts"],
    }, null, 2),
  );

  run(
    pnpm,
    ["add", "--ignore-scripts", tarball],
    { cwd: consumerRoot },
  );

  run(
    process.execPath,
    [
      join(root, "node_modules", "typescript", "bin", "tsc"),
      "--project",
      "tsconfig.json",
      "--pretty",
      "false",
    ],
    { cwd: consumerRoot },
  );
  run(process.execPath, ["runtime.mjs"], { cwd: consumerRoot });
}

async function main() {
  run(pnpm, ["install", "--frozen-lockfile"]);
  run(pnpm, ["typecheck"]);
  run(pnpm, ["test"]);
  run(pnpm, ["build"]);

  const packageMetadata = JSON.parse(await readFile(
    join(packageRoot, "package.json"),
    "utf8",
  ));
  const manifest = parsePackManifest(
    run(
      pnpm,
      ["pack", "--dry-run", "--json"],
      { cwd: packageRoot, capture: true },
    ),
    packageMetadata,
  );
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "okf-minisearch-package-"),
  );

  try {
    run(
      pnpm,
      ["pack", "--pack-destination", temporaryRoot],
      { cwd: packageRoot },
    );

    const tarball = join(temporaryRoot, manifest.filename);
    await access(tarball);
    await checkConsumer(tarball, temporaryRoot);
    console.log(
      `\nPackage validation passed: ${relative(root, packageRoot)}`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
