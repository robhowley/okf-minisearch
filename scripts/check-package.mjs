import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
  relative,
  resolve,
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

function parsePackManifest(output) {
  let manifest;

  try {
    manifest = JSON.parse(output);
  } catch {
    throw new Error("pnpm pack did not return valid JSON");
  }

  assert.equal(typeof manifest.filename, "string");
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

  const sourceFiles = paths.filter((path) =>
    path.endsWith(".ts") &&
    !path.endsWith(".d.ts"));
  assert.deepEqual(
    sourceFiles,
    [],
    `packed package contains source files: ${sourceFiles.join(", ")}`,
  );

  const unexpected = paths.filter((path) =>
    !["LICENSE", "README.md", "package.json"].includes(path) &&
    !/^dist\/[^/]+(?:\.js|\.d\.ts)$/.test(path));
  assert.deepEqual(
    unexpected,
    [],
    `packed package has unexpected files: ${unexpected.join(", ")}`,
  );

  return manifest;
}

const typeConsumer = `import { OkfError, openOkf, validateOkfDocument } from "okf-minisearch";
import type {
  IsoDateTime,
  OkfAttester,
  OkfDiagnostic,
  OkfDiagnosticCode,
  OkfDocument,
  OkfDocumentInput,
  OkfErrorCode,
  OkfExecutor,
  OkfGeneration,
  OkfIngestResult,
  OkfParameter,
  OkfSearch,
  OkfSearchField,
  OkfSearchHit,
  OkfSearchOptions,
  OkfSource,
  OkfStatus,
  OkfTimeWindow,
  OkfTrustTier,
  OkfValidationResult,
  OkfVerification,
} from "okf-minisearch";
// @ts-expect-error OkfIndexRecord is internal and not part of the package root API.
import type { OkfIndexRecord } from "okf-minisearch";

type ExpectedOkfSearchField =
  | "resource"
  | "title"
  | "heading"
  | "description"
  | "tags"
  | "type"
  | "sources"
  | "body";
type Same<T, U> =
  (<V>() => V extends T ? 1 : 2) extends
  (<V>() => V extends U ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type ExactSearchField = Assert<
  Same<OkfSearchField, ExpectedOkfSearchField>
>;
type ExactFuzzy = Assert<
  Same<OkfSearchOptions["fuzzy"], boolean | number | undefined>
>;
type ExactSearchBoost = Assert<
  Same<
    OkfSearchOptions["boost"],
    Readonly<Partial<Record<OkfSearchField, number>>> | undefined
  >
>;
type ExactRemove = Assert<
  Same<OkfSearch["remove"], (path: string) => boolean>
>;
type ExactValidationResult = Assert<
  Same<OkfValidationResult, {
    readonly isValid: boolean;
    readonly errors: readonly OkfDiagnostic[];
  }>
>;
type ExactIngestResult = Assert<
  Same<OkfIngestResult, { document: OkfDocument }>
>;
type ExactDocumentStatus = Assert<
  Same<OkfDocument["status"], OkfStatus>
>;
const readonlyFields = ["heading", "body"] as const;
const readonlyBoosts = { title: 1.5, body: 2 } as const;
const searchOptions: OkfSearchOptions = {
  match: "all",
  fields: readonlyFields,
  fuzzy: 0.2,
  boost: readonlyBoosts,
};
// @ts-expect-error MiniSearch's internal field name is not public.
const internalHeadingBoost: OkfSearchOptions = { boost: { headingPath: 2 } };
// @ts-expect-error MiniSearch's internal field name is not public.
const internalSourceBoost: OkfSearchOptions = { boost: { sourceText: 2 } };
// @ts-expect-error MiniSearch's internal field name is not public.
const internalBodyBoost: OkfSearchOptions = { boost: { text: 2 } };
// @ts-expect-error Boost values must be numbers.
const stringBoost: OkfSearchOptions = { boost: { title: "high" } };
// @ts-expect-error Nested boost wrapper is not a public search option.
const nestedBoostOption: OkfSearchOptions = { ["relevance"]: { boost: { title: 2 } } };
const searchHit = null as unknown as OkfSearchHit;
const matchedField: OkfSearchField =
  searchHit.matchedFields[0] ?? "body";
const remove = null as unknown as OkfSearch["remove"];
const removalResult: boolean = remove("consumer.md");
// @ts-expect-error MiniSearch's internal field name is not public.
const internalField: OkfSearchField = "headingPath";
const validator: (
  input: OkfDocumentInput,
) => OkfValidationResult = validateOkfDocument;
const validationResult: OkfValidationResult = {
  isValid: true,
  errors: [],
};
const diagnosticCode: OkfDiagnosticCode = "ERR_OKF_FIELD";
const diagnostic: OkfDiagnostic = {
  code: diagnosticCode,
  path: "consumer.md",
  field: "type",
  message: "Invalid OKF field: consumer.md (type)",
};
// @ts-expect-error Diagnostics do not expose severity.
diagnostic.severity = "error";

void [
  OkfError,
  openOkf,
  validator,
  validationResult,
  diagnostic,
  null as IsoDateTime | null,
  null as OkfAttester | null,
  null as OkfDiagnostic | null,
  null as OkfDocument | null,
  null as OkfDocumentInput | null,
  null as OkfErrorCode | null,
  null as OkfExecutor | null,
  null as OkfGeneration | null,
  null as OkfIndexRecord | null,
  null as OkfIngestResult | null,
  null as OkfParameter | null,
  null as OkfSearch | null,
  null as OkfSearchHit | null,
  null as OkfSearchOptions | null,
  readonlyBoosts,
  internalHeadingBoost,
  internalSourceBoost,
  internalBodyBoost,
  stringBoost,
  nestedBoostOption,
  searchOptions,
  matchedField,
  removalResult,
  null as ExactSearchField | null,
  null as ExactRemove | null,
  null as ExactFuzzy | null,
  null as ExactSearchBoost | null,
  null as ExactValidationResult | null,
  null as ExactIngestResult | null,
  null as ExactDocumentStatus | null,
  null as OkfSource | null,
  null as OkfStatus | null,
  null as OkfTimeWindow | null,
  null as OkfTrustTier | null,
  null as OkfVerification | null,
];
`;

const runtimeConsumer = `import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as api from "okf-minisearch";

assert.deepEqual(Object.keys(api).sort(), ["OkfError", "openOkf", "validateOkfDocument"]);
assert.equal(typeof api.OkfError, "function");
assert.equal(typeof api.openOkf, "function");
assert.equal(typeof api.validateOkfDocument, "function");
const validationResult = api.validateOkfDocument({
  path: "consumer.md",
  markdown: "---\\ntype: note\\n---\\nbody",
});
assert.deepEqual(validationResult, { isValid: true, errors: [] });
assert.equal(validationResult.isValid, true);
assert.deepEqual(validationResult.errors, []);

const root = await mkdtemp(join(tmpdir(), "okf-minisearch-consumer-"));
try {
  const okf = await api.openOkf(root);
  const ingestResult = okf.ingest({
    path: "consumer.md",
    markdown: "---\\ntype: note\\n---\\npackedremovalneedle",
  });
  assert.deepEqual(Object.keys(ingestResult), ["document"]);
  assert.equal(ingestResult.document.status, "stable");
  assert.equal(Object.hasOwn(ingestResult, "records"), false);
  assert.equal(Object.hasOwn(ingestResult, "diagnostics"), false);

  assert.equal(typeof okf.remove, "function");
  assert.equal(
    okf.search("packedremovalneedle", {
      boost: { body: 2 },
    }).length,
    1,
  );
  assert.equal(okf.search("packedremovalneedle").length, 1);
  assert.equal(okf.remove("./consumer.md"), true);
  assert.deepEqual(okf.search("packedremovalneedle"), []);
  assert.equal(okf.remove("consumer.md"), false);
  assert.equal(okf.remove("missing.md"), false);
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
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "okf-minisearch-package-"),
  );

  try {
    const manifest = parsePackManifest(
      run(
        pnpm,
        ["pack", "--pack-destination", temporaryRoot, "--json"],
        { cwd: packageRoot, capture: true },
      ),
    );
    const tarball = resolve(packageRoot, manifest.filename);

    await access(tarball);
    await checkConsumer(tarball, temporaryRoot);
    console.log(
      `\nPacked package passed install and runtime checks: ${relative(root, packageRoot)}`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
