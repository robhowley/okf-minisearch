import assert from "node:assert/strict";
import {
  access,
  copyFile,
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
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoots = {
  library: join(root, "packages", "okf-minisearch"),
  pi: join(root, "packages", "pi-okf-search"),
};
const packageNames = {
  library: "okf-minisearch",
  pi: "@robhowley/pi-okf-search",
};
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

function parsePackResult(output, packageName) {
  let manifest;

  try {
    manifest = JSON.parse(output);
  } catch {
    throw new Error(`${packageName}: pnpm pack did not return valid JSON`);
  }

  assert.equal(
    manifest.name,
    packageName,
    `${packageName}: pack result has the wrong package name`,
  );
  assert.equal(
    typeof manifest.filename,
    "string",
    `${packageName}: pack result filename must be a string`,
  );
  assert.ok(
    manifest.filename.length > 0,
    `${packageName}: pack result filename must not be empty`,
  );
  assert.ok(
    Array.isArray(manifest.files),
    `${packageName}: pack result files must be an array`,
  );
  assert.ok(
    manifest.files.every((file) => typeof file?.path === "string"),
    `${packageName}: every packed file must have a string path`,
  );

  return {
    manifest,
    paths: manifest.files.map((file) => file.path).sort(),
  };
}

function checkLibraryPaths(paths) {
  const required = [
    "LICENSE",
    "README.md",
    "dist/index.d.ts",
    "dist/index.js",
    "package.json",
  ];

  for (const path of required) {
    assert.ok(
      paths.includes(path),
      `${packageNames.library}: packed package is missing ${path}`,
    );
  }

  const sourceFiles = paths.filter((path) =>
    path.endsWith(".ts") &&
    !path.endsWith(".d.ts"));
  assert.deepEqual(
    sourceFiles,
    [],
    `${packageNames.library}: packed package contains source files: ${sourceFiles.join(", ")}`,
  );

  const unexpected = paths.filter((path) =>
    !["LICENSE", "README.md", "package.json"].includes(path) &&
    !/^dist\/[^/]+(?:\.js|\.d\.ts)$/.test(path));
  assert.deepEqual(
    unexpected,
    [],
    `${packageNames.library}: packed package has unexpected files: ${unexpected.join(", ")}`,
  );
}

function checkPiPaths(paths) {
  assert.deepEqual(
    paths,
    [
      "LICENSE",
      "README.md",
      "extensions/okf-search/config.ts",
      "extensions/okf-search/index.ts",
      "extensions/okf-search/runtime.ts",
      "package.json",
    ],
    `${packageNames.pi}: packed paths do not match the source-only contract`,
  );
}

function assertUnder(parent, path, label) {
  const fromParent = relative(parent, path);
  assert.ok(
    fromParent !== "" &&
      fromParent !== ".." &&
      !fromParent.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(fromParent),
    `${label} must be below ${parent}; received ${path}`,
  );
}

async function packPackage(id, tarballRoot, temporaryRoot) {
  const packageName = packageNames[id];
  const packageRoot = packageRoots[id];
  const result = parsePackResult(
    run(
      pnpm,
      ["pack", "--pack-destination", tarballRoot, "--json"],
      { cwd: packageRoot, capture: true },
    ),
    packageName,
  );
  const tarball = resolve(packageRoot, result.manifest.filename);

  assertUnder(temporaryRoot, tarball, `${packageName} tarball`);
  assertUnder(tarballRoot, tarball, `${packageName} tarball`);
  await access(tarball);

  if (id === "library") {
    checkLibraryPaths(result.paths);
  } else {
    checkPiPaths(result.paths);
  }

  return { tarball, result };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
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

const root = join(process.cwd(), "fixture");
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
`;

function smokeConsumer(libraryVersion) {
  return `import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const consumerRoot = dirname(fileURLToPath(import.meta.url));
const agentDir = join(consumerRoot, "agent");
const markerPath = join(consumerRoot, "fixture", "marker.md");
process.env.PI_CODING_AGENT_DIR = agentDir;

const {
  DefaultResourceLoader,
  SettingsManager,
} = await import("@earendil-works/pi-coding-agent");

const settingsManager = SettingsManager.create(consumerRoot, agentDir);
const loader = new DefaultResourceLoader({
  cwd: consumerRoot,
  agentDir,
  settingsManager,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
});
await loader.reload();

const loaded = loader.getExtensions();
assert.deepEqual(loaded.errors, [], "Pi loader reported extension errors");
assert.equal(loaded.extensions.length, 1, "expected exactly one Pi extension");
const extension = loaded.extensions[0];
assert.ok(
  extension.resolvedPath.replaceAll("\\\\", "/").endsWith("extensions/okf-search/index.ts"),
  "Pi did not discover the packed TypeScript entry",
);
const startupHandlers = extension.handlers.get("session_start") ?? [];
assert.equal(startupHandlers.length, 1, "expected one session_start handler");
assert.deepEqual([...extension.tools.keys()].sort(), ["okf_search"]);

const notifications = [];
const context = {
  cwd: consumerRoot,
  mode: "json",
  hasUI: false,
  isProjectTrusted: () => true,
  ui: {
    notify: (...notification) => notifications.push(notification),
  },
};

await startupHandlers[0]({ type: "session_start", reason: "startup" }, context);
assert.equal(
  notifications.some((notification) => notification[1] === "warning"),
  false,
  "session startup emitted a warning",
);

const tool = extension.tools.get("okf_search");
assert.ok(tool, "okf_search was not registered");
const result = await tool.definition.execute(
  "packed-source-smoke",
  { query: "packedsourcemarker" },
  undefined,
  undefined,
  context,
);
const text = result.content
  .filter((part) => part.type === "text")
  .map((part) => part.text)
  .join("\\n");
for (const expected of [
  "1 hit",
  "Packed source consumer",
  "packedsourcemarker",
  markerPath,
]) {
  assert.ok(text.includes(expected), "search result is missing expected packed marker content");
}

const installedLibraryManifest = JSON.parse(
  await readFile(join(consumerRoot, "node_modules", "okf-minisearch", "package.json"), "utf8"),
);
assert.equal(installedLibraryManifest.version, ${JSON.stringify(libraryVersion)});
`;
}

async function inspectPiManifest(piTarball, extractionRoot, libraryVersion) {
  await mkdir(extractionRoot, { recursive: true });
  run("tar", ["-xzf", piTarball, "-C", extractionRoot]);

  const manifestPath = join(extractionRoot, "package", "package.json");
  const serialized = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(serialized);
  const expectedLibraryRange = `^${libraryVersion}`;

  assert.deepEqual(manifest.files, ["extensions"]);
  assert.deepEqual(manifest.scripts, {
    typecheck: "tsc -p tsconfig.test.json",
    test: "vitest run",
  });
  assert.deepEqual(manifest.pi, {
    extensions: ["./extensions/okf-search/index.ts"],
  });
  assert.deepEqual(manifest.dependencies, {
    "okf-minisearch": expectedLibraryRange,
  });
  assert.deepEqual(manifest.peerDependencies, {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    typebox: "*",
  });
  assert.equal(
    manifest.dependencies["okf-minisearch"],
    expectedLibraryRange,
    `${packageNames.pi}: packed dependency must be ${expectedLibraryRange}`,
  );
  assert.equal(serialized.includes("workspace:"), false);
  assert.equal(Object.hasOwn(manifest, "main"), false);
  assert.equal(Object.hasOwn(manifest, "types"), false);
  assert.equal(Object.hasOwn(manifest, "exports"), false);
  assert.equal(Object.hasOwn(manifest.scripts, "build"), false);
  assert.equal(
    Object.hasOwn(manifest.peerDependencies ?? {}, "okf-minisearch"),
    false,
  );
  assert.equal(
    Object.hasOwn(manifest.devDependencies ?? {}, "okf-minisearch"),
    false,
  );
}

async function prepareConsumer(
  temporaryRoot,
  libraryTarball,
  piTarball,
  libraryVersion,
) {
  const consumerRoot = join(temporaryRoot, "consumer");
  const agentDir = join(consumerRoot, "agent");
  const fixtureDir = join(consumerRoot, "fixture");
  const libraryFilename = basename(libraryTarball);
  const piFilename = basename(piTarball);

  await mkdir(agentDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  await writeJson(join(temporaryRoot, "package.json"), {
    name: "okf-minisearch-packed-consumer-workspace",
    private: true,
    packageManager: "pnpm@11.22.0",
  });
  await writeFile(
    join(temporaryRoot, "pnpm-workspace.yaml"),
    [
      "packages:",
      "  - consumer",
      "overrides:",
      `  okf-minisearch: file:./tarballs/${libraryFilename}`,
      "",
    ].join("\n"),
  );
  await copyFile(
    join(root, "pnpm-lock.yaml"),
    join(temporaryRoot, "pnpm-lock.yaml"),
  );
  await writeJson(join(consumerRoot, "package.json"), {
    name: "okf-minisearch-packed-consumer",
    private: true,
    type: "module",
    dependencies: {
      "okf-minisearch": `file:../tarballs/${libraryFilename}`,
      "@robhowley/pi-okf-search": `file:../tarballs/${piFilename}`,
      "@earendil-works/pi-ai": "0.84.3",
      "@earendil-works/pi-coding-agent": "0.84.3",
      typebox: "1.3.7",
    },
  });
  await writeFile(join(consumerRoot, "consumer.mts"), typeConsumer);
  await writeFile(join(consumerRoot, "runtime.mjs"), runtimeConsumer);
  await writeFile(join(consumerRoot, "smoke.mjs"), smokeConsumer(libraryVersion));
  await writeJson(join(consumerRoot, "tsconfig.json"), {
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
  });
  await writeFile(
    join(fixtureDir, "marker.md"),
    [
      "---",
      "type: note",
      "title: Packed source consumer",
      "status: stable",
      "---",
      "# Packed source consumer",
      "",
      "packedsourcemarker",
      "",
    ].join("\n"),
  );
  await writeJson(join(agentDir, "settings.json"), {
    packages: [join(consumerRoot, "node_modules", "@robhowley", "pi-okf-search")],
    "pi-okf-search": { root: "../fixture" },
  });

  return consumerRoot;
}

function checkLibraryConsumer(consumerRoot) {
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
    const tarballRoot = join(temporaryRoot, "tarballs");
    await mkdir(tarballRoot);

    const libraryPackage = await packPackage(
      "library",
      tarballRoot,
      temporaryRoot,
    );
    const piPackage = await packPackage("pi", tarballRoot, temporaryRoot);
    const libraryManifest = JSON.parse(
      await readFile(join(packageRoots.library, "package.json"), "utf8"),
    );
    const libraryVersion = libraryManifest.version;
    assert.equal(typeof libraryVersion, "string");
    assert.ok(libraryVersion.length > 0);

    await inspectPiManifest(
      piPackage.tarball,
      join(temporaryRoot, "extracted", "pi"),
      libraryVersion,
    );
    const consumerRoot = await prepareConsumer(
      temporaryRoot,
      libraryPackage.tarball,
      piPackage.tarball,
      libraryVersion,
    );

    run(
      pnpm,
      ["install", "--ignore-scripts", "--no-frozen-lockfile"],
      { cwd: temporaryRoot },
    );
    checkLibraryConsumer(consumerRoot);
    run(process.execPath, ["consumer/smoke.mjs"], { cwd: temporaryRoot });

    console.log(
      `\nPacked packages passed manifest, install, TypeScript, runtime, and Pi loader checks: ${relative(root, packageRoots.library)}, ${relative(root, packageRoots.pi)}`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
