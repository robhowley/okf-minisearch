import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
import { runInNewContext } from "node:vm";

import { nodeResolve } from "@rollup/plugin-node-resolve";
import { build as esbuild } from "esbuild";
import { rollup } from "rollup";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoots = {
  library: join(root, "packages", "okf-minisearch"),
  pi: join(root, "packages", "pi-okf-search"),
  native: join(root, "packages", "okf-search-native"),
};
const packageNames = {
  library: "okf-minisearch",
  pi: "pi-okf-search",
  native: "okf-search-native",
};
const nativeArtifactSuffixes = {
  darwin: { x64: "darwin-x64", arm64: "darwin-arm64" },
  linux: { x64: "linux-x64-gnu" },
  win32: { x64: "win32-x64-msvc" },
};
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const PRIVATE_PACKAGE_NAME = "@okf-internal/prepare";
const FORBIDDEN_PACKED_MARKERS = [PRIVATE_PACKAGE_NAME, "workspace:"];

function currentNativeArtifact() {
  const suffix = nativeArtifactSuffixes[process.platform]?.[process.arch];
  assert.ok(
    suffix,
    `${packageNames.native}: unsupported validation host ${process.platform}/${process.arch}`,
  );
  return `${packageNames.native}.${suffix}.node`;
}

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
    "dist/browser.d.ts",
    "dist/browser.js",
    "dist/browser.min.js",
    "dist/create-okf-search.d.ts",
    "dist/create-okf-search.js",
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

function checkNativePaths(paths) {
  const hostArtifact = currentNativeArtifact();
  const required = [
    "LICENSE",
    "README.md",
    "index.d.ts",
    "index.js",
    "package.json",
    hostArtifact,
  ];
  const leaked = paths.filter((path) =>
    path.endsWith(".rs") ||
    (path.endsWith(".ts") && !path.endsWith(".d.ts")) ||
    /(?:^|\/)(?:src|target|test|tests|docs)(?:\/|$)/.test(path),
  );

  assert.deepEqual(
    leaked,
    [],
    `${packageNames.native}: packed package contains source/build/test files: ${leaked.join(", ")}`,
  );
  assert.deepEqual(
    paths,
    required.sort(),
    `${packageNames.native}: packed paths must contain only the generated host package files`,
  );
  assert.deepEqual(
    paths.filter((path) => path.endsWith(".node")),
    [hostArtifact],
    `${packageNames.native}: packed package must contain exactly the current host native artifact`,
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

async function scanPackedPackage(extractionRoot, packageName) {
  const packageRoot = join(extractionRoot, "package");
  const manifestPath = join(packageRoot, "package.json");
  const manifest = await readFile(manifestPath, "utf8");

  for (const marker of FORBIDDEN_PACKED_MARKERS) {
    assert.equal(
      manifest.includes(marker),
      false,
      `${packageName}: packed manifest contains ${marker}`,
    );
  }

  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await scan(path);
      } else if (/\.(?:js|mjs|cjs)$/.test(entry.name) || entry.name.endsWith(".ts")) {
        const contents = await readFile(path, "utf8");
        for (const marker of FORBIDDEN_PACKED_MARKERS) {
          assert.equal(
            contents.includes(marker),
            false,
            `${packageName}: packed ${relative(packageRoot, path)} contains ${marker}`,
          );
        }
      }
    }
  }

  await scan(packageRoot);
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
  } else if (id === "pi") {
    checkPiPaths(result.paths);
  } else {
    checkNativePaths(result.paths);
  }

  return { tarball, result };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

const typeConsumer = `import { OkfError, createOkfSearch, openOkf, validateOkfDocument } from "okf-minisearch";
import type {
  IsoDateTime,
  OkfAttester,
  OkfAutoSuggestOptions,
  OkfConformance,
  OkfDiagnostic,
  OkfDiagnosticCode,
  OkfDegradedDocument,
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
  OkfSuggestion,
  OkfTimeWindow,
  OkfTrustTier,
  OkfValidationResult,
  OkfVerification,
} from "okf-minisearch";
// @ts-expect-error OkfBundle is internal and not part of the package root API.
import type { OkfBundle } from "okf-minisearch";
// @ts-expect-error OkfReservedFile is internal and not part of the package root API.
import type { OkfReservedFile } from "okf-minisearch";
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
type ExactConformance = Assert<
  Same<OkfConformance, "strict" | "degraded">
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
type ExactCreateOkfSearch = Assert<
  Same<typeof createOkfSearch,
    (documents: readonly OkfDocumentInput[]) => OkfSearch>
>;
type ExactNodeOpenOkf = Assert<
  Same<typeof openOkf, (root: string) => Promise<OkfSearch>>
>;
type ExactListDegradedDocuments = Assert<
  Same<OkfSearch["listDegradedDocuments"], () => readonly OkfDegradedDocument[]>
>;
type ExactListTypes = Assert<
  Same<OkfSearch["listTypes"], () => readonly string[]>
>;
type ExactRemove = Assert<
  Same<OkfSearch["remove"], (path: string) => boolean>
>;
type ExactValidationResult = Assert<
  Same<OkfValidationResult,
    | {
        readonly isValid: true;
        readonly isIndexable: true;
        readonly errors: readonly [];
      }
    | {
        readonly isValid: false;
        readonly isIndexable: true;
        readonly errors: readonly [OkfDiagnostic, ...OkfDiagnostic[]];
      }
    | {
        readonly isValid: false;
        readonly isIndexable: false;
        readonly errors: readonly [OkfDiagnostic, ...OkfDiagnostic[]];
      }
  >
>;
type ExactDegradedDocument = Assert<
  Same<OkfDegradedDocument, {
    readonly documentId: string;
    readonly path: string;
    readonly diagnostics: readonly [OkfDiagnostic, ...OkfDiagnostic[]];
  }>
>;
type ExactIngestResult = Assert<
  Same<OkfIngestResult,
    | {
        readonly conformance: "strict";
        readonly document: OkfDocument;
      }
    | ({ readonly conformance: "degraded" } & OkfDegradedDocument)
  >
>;
type ExactSearchOptionKeys = Assert<
  Same<keyof OkfSearchOptions,
    "limit" | "where" | "asOf" | "match" | "fields" | "boost" | "fuzzy"
  >
>;
type ExactSearchWhereKeys = Assert<
  Same<keyof NonNullable<OkfSearchOptions["where"]>,
    "types" | "tagsAny" | "statuses" | "trustTiers" | "stale"
      | "conformance"
  >
>;
type ExactSearchConformance = Assert<
  Same<NonNullable<OkfSearchOptions["where"]>["conformance"],
    readonly OkfConformance[] | undefined
  >
>;
type ExactSearchHitKeys = Assert<
  Same<keyof OkfSearchHit,
    | "documentId"
    | "title"
    | "sectionId"
    | "conformance"
    | "score"
    | "matchedFields"
    | "headingPath"
    | "path"
    | "startLine"
    | "endLine"
    | "snippet"
  >
>;
type ExactSearchHitConformance = Assert<
  Same<OkfSearchHit["conformance"], OkfConformance>
>;
type ExactAutoSuggestOptions = Assert<
  Same<OkfAutoSuggestOptions, OkfSearchOptions>
>;
type ExactSuggestion = Assert<
  Same<OkfSuggestion, {
    readonly suggestion: string;
    readonly terms: readonly string[];
    readonly score: number;
  }>
>;
type ExactAutoSuggest = Assert<
  Same<OkfSearch["autoSuggest"],
    (query: string, options?: OkfAutoSuggestOptions) => OkfSuggestion[]>
>;
type ExactDocumentStatus = Assert<
  Same<OkfDocument["status"], OkfStatus>
>;
const readonlyFields = ["heading", "body"] as const;
const readonlyBoosts = { title: 1.5, body: 2 } as const;
const readonlyConformance = ["strict", "degraded"] as const;
const searchOptions: OkfSearchOptions = {
  match: "all",
  fields: readonlyFields,
  fuzzy: 0.2,
  boost: readonlyBoosts,
  where: { conformance: readonlyConformance },
};
const autoSuggestOptions: OkfAutoSuggestOptions = {
  match: "all",
  fields: readonlyFields,
  fuzzy: 0.2,
  boost: readonlyBoosts,
  where: { conformance: readonlyConformance },
};
// @ts-expect-error Conformance filters are readonly.
searchOptions.where?.conformance?.push("strict");
// @ts-expect-error MiniSearch's internal field name is not public.
const internalAutoSuggestBoost: OkfAutoSuggestOptions = { boost: { headingPath: 2 } };
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
const hitConformance: OkfConformance = searchHit.conformance;
const matchedField: OkfSearchField =
  searchHit.matchedFields[0] ?? "body";
const listDegradedDocuments = null as unknown as OkfSearch["listDegradedDocuments"];
const degradedDocuments: readonly OkfDegradedDocument[] = listDegradedDocuments();
const listTypes = null as unknown as OkfSearch["listTypes"];
const types: readonly string[] = listTypes();
const remove = null as unknown as OkfSearch["remove"];
const removalResult: boolean = remove("consumer.md");
const direct: OkfSearch = createOkfSearch([]);
const opened: Promise<OkfSearch> = openOkf("./knowledge");
// @ts-expect-error The Node declaration accepts only a filesystem root string.
openOkf([]);
const autoSuggest = null as unknown as OkfSearch["autoSuggest"];
const autoSuggestions: OkfSuggestion[] = autoSuggest(
  "consumer",
  autoSuggestOptions,
);
const suggestion = null as unknown as OkfSuggestion;
const suggestionText: string = suggestion.suggestion;
const suggestionTerms: readonly string[] = suggestion.terms;
const suggestionScore: number = suggestion.score;
// @ts-expect-error Suggestion terms are readonly.
suggestion.terms.push("unexpected");
// @ts-expect-error MiniSearch's internal field name is not public.
const internalField: OkfSearchField = "headingPath";
const validator: (
  input: OkfDocumentInput,
) => OkfValidationResult = validateOkfDocument;
const validationResult: OkfValidationResult = {
  isValid: true,
  isIndexable: true,
  errors: [],
};
const diagnosticCode: OkfDiagnosticCode = "ERR_OKF_FIELD";
const diagnostic: OkfDiagnostic = {
  code: diagnosticCode,
  path: "consumer.md",
  field: "type",
  message: "Invalid OKF field: consumer.md (type)",
};
const degradedDocument: OkfDegradedDocument = {
  documentId: "consumer",
  path: "consumer.md",
  diagnostics: [diagnostic],
};
declare const ingestResult: OkfIngestResult;
if (ingestResult.conformance === "strict") {
  const strictDocument: OkfDocument = ingestResult.document;
  void strictDocument;
} else {
  const degradedResult: OkfDegradedDocument = ingestResult;
  // @ts-expect-error Degraded ingest does not expose a document.
  ingestResult.document;
  void degradedResult;
}
// @ts-expect-error Diagnostics do not expose severity.
diagnostic.severity = "error";

void [
  OkfError,
  createOkfSearch,
  openOkf,
  direct,
  opened,
  validator,
  validationResult,
  diagnostic,
  degradedDocument,
  degradedDocuments,
  null as unknown as OkfConformance,
  null as IsoDateTime | null,
  null as OkfAttester | null,
  null as OkfDiagnostic | null,
  null as OkfDocument | null,
  null as OkfDocumentInput | null,
  null as OkfErrorCode | null,
  null as OkfExecutor | null,
  null as OkfGeneration | null,
  null as OkfBundle | null,
  null as OkfReservedFile | null,
  null as OkfIndexRecord | null,
  null as OkfIngestResult | null,
  null as OkfDegradedDocument | null,
  null as OkfParameter | null,
  null as OkfSearch | null,
  null as OkfSearchHit | null,
  null as OkfSearchOptions | null,
  readonlyBoosts,
  readonlyConformance,
  internalHeadingBoost,
  internalSourceBoost,
  internalBodyBoost,
  stringBoost,
  nestedBoostOption,
  searchOptions,
  autoSuggestOptions,
  internalAutoSuggestBoost,
  autoSuggestions,
  suggestionText,
  suggestionTerms,
  suggestionScore,
  hitConformance,
  matchedField,
  types,
  removalResult,
  listDegradedDocuments,
  null as ExactSearchField | null,
  null as ExactConformance | null,
  null as ExactCreateOkfSearch | null,
  null as ExactNodeOpenOkf | null,
  null as ExactListDegradedDocuments | null,
  null as ExactListTypes | null,
  null as ExactRemove | null,
  null as ExactFuzzy | null,
  null as ExactSearchBoost | null,
  null as ExactValidationResult | null,
  null as ExactDegradedDocument | null,
  null as ExactIngestResult | null,
  null as ExactSearchOptionKeys | null,
  null as ExactSearchWhereKeys | null,
  null as ExactSearchConformance | null,
  null as ExactSearchHitKeys | null,
  null as ExactSearchHitConformance | null,
  null as ExactAutoSuggestOptions | null,
  null as ExactSuggestion | null,
  null as ExactAutoSuggest | null,
  null as ExactDocumentStatus | null,
  null as OkfSource | null,
  null as OkfStatus | null,
  null as OkfTimeWindow | null,
  null as OkfTrustTier | null,
  null as OkfVerification | null,
];
`;

const browserTypeConsumer = `import {
  OkfError,
  createOkfSearch,
  openOkf,
  validateOkfDocument,
} from "okf-minisearch";
import type {
  OkfAutoSuggestOptions,
  OkfDocumentInput,
  OkfSearch,
  OkfSearchOptions,
  OkfSuggestion,
} from "okf-minisearch";

type Same<T, U> =
  (<V>() => V extends T ? 1 : 2) extends
  (<V>() => V extends U ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type ExactCreate = Assert<Same<
  typeof createOkfSearch,
  (documents: readonly OkfDocumentInput[]) => OkfSearch
>>;
type ExactBrowserOpen = Assert<Same<
  typeof openOkf,
  (files: FileList | readonly File[]) => Promise<OkfSearch>
>>;
type ExactOptions = Assert<Same<OkfAutoSuggestOptions, OkfSearchOptions>>;

const direct: OkfSearch = createOkfSearch([]);
const files = null as unknown as FileList;
const opened: Promise<OkfSearch> = openOkf(files);
const openedArray: Promise<OkfSearch> = openOkf([] as readonly File[]);
const suggestions: OkfSuggestion[] = direct.autoSuggest("browser");
// @ts-expect-error The browser declaration accepts only selected files.
openOkf("./knowledge");

void [
  OkfError,
  validateOkfDocument,
  direct,
  opened,
  openedArray,
  suggestions,
  null as ExactCreate | null,
  null as ExactBrowserOpen | null,
  null as ExactOptions | null,
];
`;

const browserRuntimeConsumer = `import * as api from "okf-minisearch";

const equal = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + ": " + JSON.stringify(actual));
  }
};
equal(Object.keys(api).sort(), [
  "OkfError",
  "createOkfSearch",
  "openOkf",
  "validateOkfDocument",
], "browser runtime exports");
const markdown = "---\\ntype: browser\\n---\\npackedbrowserneedle";
const bytes = new TextEncoder().encode(markdown);
const file = {
  name: "browser.md",
  webkitRelativePath: "knowledge/browser.md",
  arrayBuffer: async () => bytes.slice().buffer,
};
const okf = await api.openOkf([file]);
equal(okf.listTypes(), ["browser"], "browser types");
if (okf.search("packedbrowserneedle").length !== 1) {
  throw new Error("browser root import did not search selected file");
}
const direct = api.createOkfSearch([{
  path: "direct.md",
  markdown,
}]);
if (direct.autoSuggest("packedbrowser").length !== 1) {
  throw new Error("browser createOkfSearch did not expose autoSuggest");
}
const readCause = new Error("packed browser read cause");
try {
  await api.openOkf([{
    name: "failure.md",
    webkitRelativePath: "knowledge/failure.md",
    arrayBuffer: async () => { throw readCause; },
  }]);
  throw new Error("browser read failure did not reject");
} catch (error) {
  if (!(error instanceof api.OkfError) || !(error instanceof Error)) throw error;
  equal(error.code, "ERR_OKF_READ", "browser read error code");
  equal(error.path, "failure.md", "browser read error path");
  equal(error.message, "Cannot read OKF path: failure.md", "browser read error message");
  if (error.cause !== readCause) throw new Error("browser read error lost its cause");
  if (Object.hasOwn(error, "field")) throw new Error("browser read error owns field");
}
`;

const nodeBundleConsumer = `import { openOkf } from "okf-minisearch";
if (typeof openOkf !== "function") throw new Error("missing Node openOkf");
`;

const privateResolutionConsumer = `import assert from "node:assert/strict";
import { createRequire } from "node:module";

const privatePackage = "@okf-internal/prepare";
const require = createRequire(import.meta.url);
assert.throws(
  () => require.resolve(privatePackage),
  (error) => error?.code === "MODULE_NOT_FOUND",
  "require.resolve unexpectedly found the private package",
);
assert.throws(
  () => import.meta.resolve(privatePackage),
  (error) => error?.code === "ERR_MODULE_NOT_FOUND",
  "import.meta.resolve unexpectedly found the private package",
);
`;

const nativeTypeConsumer = `import { NativeOkfSearch } from "okf-search-native";
import type {
  DegradedDocument,
  Diagnostic,
  PreparedDocument,
  PreparedSection,
  RemoveIdentity,
  SearchBoost,
  SearchHit,
  SearchOptions,
  SearchWhere,
  Suggestion,
} from "okf-search-native";

const diagnostic: Diagnostic = {
  code: "ERR_OKF_FIELD",
  message: "fixture degradation",
  path: "native.md",
};
const section: PreparedSection = {
  sectionId: "native-doc#root",
  documentId: "native-doc",
  conformance: "strict",
  title: "Native prepared document",
  path: "native.md",
  type: "note",
  tags: ["native"],
  stalenessClassified: false,
  resource: "native-doc",
  headingPath: "Native prepared document",
  description: "A prepared native package fixture.",
  sourceText: "",
  text: "nativepackedneedle",
  startLine: 1,
  endLine: 3,
};
const document: PreparedDocument = {
  documentId: "native-doc",
  path: "native.md",
  type: "note",
  conformance: "strict",
  diagnostics: [],
  sections: [section],
};
const identity: RemoveIdentity = {
  documentId: document.documentId,
  path: document.path,
};
const where: SearchWhere = {
  types: ["note"],
  tagsAny: ["native"],
  statuses: ["stable"],
  trustTiers: ["human-reviewed"],
  stale: false,
  conformance: ["strict"],
};
const boost: SearchBoost = { body: 2 };
const options: SearchOptions = {
  limit: 10,
  where,
  asOf: new Date(),
  match: "all",
  fields: ["body"],
  boost,
  fuzzy: 0.2,
};
const native: NativeOkfSearch = NativeOkfSearch.fromPrepared([document]);
const hits: SearchHit[] = native.search("nativepackedneedle", options);
const degraded: DegradedDocument[] = native.listDegradedDocuments();
const suggestions: Suggestion[] = native.autoSuggest("nativepackedneedle", options);
native.ingestPrepared(document);
const removed: boolean = native.removeDocument(identity);

void [diagnostic, hits, degraded, suggestions, removed];
`;

const nativeRuntimeConsumer = `import assert from "node:assert/strict";

const loaded = await import("okf-search-native");
const api = loaded.default ?? loaded;
assert.deepEqual(Object.keys(api).sort(), ["NativeOkfSearch"]);
assert.equal(typeof api.NativeOkfSearch, "function");

const prepared = {
  documentId: "native-doc",
  path: "native.md",
  type: "note",
  conformance: "strict",
  diagnostics: [],
  sections: [{
    sectionId: "native-doc#root",
    documentId: "native-doc",
    conformance: "strict",
    title: "Native prepared document",
    path: "native.md",
    type: "note",
    tags: ["native"],
    stalenessClassified: false,
    resource: "native-doc",
    headingPath: "Native prepared document",
    description: "A prepared native package fixture.",
    sourceText: "",
    text: "nativepackedneedle",
    startLine: 1,
    endLine: 3,
  }],
};
const replacement = {
  documentId: "native-doc",
  path: "native.md",
  type: "guide",
  conformance: "strict",
  diagnostics: [],
  sections: [{
    sectionId: "native-doc#root",
    documentId: "native-doc",
    conformance: "strict",
    title: "Native replacement document",
    path: "native.md",
    type: "guide",
    tags: ["replacement"],
    stalenessClassified: false,
    resource: "native-doc",
    headingPath: "Native replacement document",
    description: "A replacement native package fixture.",
    sourceText: "",
    text: "nativereplacementneedle",
    startLine: 1,
    endLine: 3,
  }],
};
const native = api.NativeOkfSearch.fromPrepared([prepared]);
assert.deepEqual(native.listTypes(), ["note"]);
assert.deepEqual(native.listDegradedDocuments(), []);
const initialHits = native.search("nativepackedneedle", {
  fields: ["body"],
});
assert.equal(initialHits.length, 1);
assert.equal(initialHits[0].documentId, "native-doc");
assert.equal(initialHits[0].path, "native.md");
assert.equal(initialHits[0].snippet, "nativepackedneedle");
assert.throws(
  () => native.autoSuggest("nativepackedneedle"),
  /\\[ERR_OKF_UNSUPPORTED\\]/,
);

native.ingestPrepared(replacement);
assert.deepEqual(native.listTypes(), ["guide"]);
assert.deepEqual(native.search("nativepackedneedle"), []);
assert.equal(native.search("nativereplacementneedle").length, 1);
assert.equal(
  native.removeDocument({ documentId: "native-doc", path: "native.md" }),
  true,
);
assert.deepEqual(native.listTypes(), []);
assert.deepEqual(native.search("nativereplacementneedle"), []);
assert.equal(
  native.removeDocument({ documentId: "native-doc", path: "native.md" }),
  false,
);
`;

const runtimeConsumer = `import assert from "node:assert/strict";
import { join } from "node:path";
import * as api from "okf-minisearch";

assert.deepEqual(Object.keys(api).sort(), ["OkfError", "createOkfSearch", "openOkf", "validateOkfDocument"]);
assert.equal(typeof api.OkfError, "function");
assert.equal(typeof api.createOkfSearch, "function");
assert.equal(typeof api.openOkf, "function");
assert.equal(typeof api.validateOkfDocument, "function");
const errorCause = new Error("packed error cause");
for (const fixture of [
  {
    code: "ERR_OKF_READ",
    path: "read.md",
    message: "Cannot read OKF path: read.md",
  },
  {
    code: "ERR_OKF_PARSE",
    path: "parse.md",
    message: "Cannot parse OKF concept: parse.md",
  },
  {
    code: "ERR_OKF_FIELD",
    path: "field.md",
    field: "type",
    message: "Invalid OKF field: field.md (type)",
  },
  {
    code: "ERR_OKF_INDEX_UNUSABLE",
    path: "index.md",
    message: "MiniSearch failed while mutating the index for index.md; this OkfSearch handle is permanently unusable and must be rebuilt",
  },
]) {
  const error = new api.OkfError(fixture.code, fixture.path, {
    ...(fixture.field === undefined ? {} : { field: fixture.field }),
    cause: errorCause,
  });
  assert.equal(error instanceof Error, true);
  assert.equal(error instanceof api.OkfError, true);
  assert.equal(error.name, "OkfError");
  assert.equal(error.code, fixture.code);
  assert.equal(error.path, fixture.path);
  assert.equal(error.message, fixture.message);
  assert.equal(error.cause, errorCause);
  assert.equal(Object.hasOwn(error, "field"), fixture.field !== undefined);
  assert.equal(error.field, fixture.field);
}
const validationResult = api.validateOkfDocument({
  path: "consumer.md",
  markdown: "---\\ntype: note\\n---\\nbody",
});
assert.deepEqual(validationResult, {
  isValid: true,
  isIndexable: true,
  errors: [],
});
assert.equal(validationResult.isValid, true);
assert.equal(validationResult.isIndexable, true);
assert.deepEqual(validationResult.errors, []);

const fatalInput = {
  path: "fatal.md",
  markdown: "---\\ntype: ' ' \\n---\\nfatalneedle",
};
const fatalValidation = api.validateOkfDocument(fatalInput);
assert.deepEqual(fatalValidation, {
  isValid: false,
  isIndexable: false,
  errors: [{
    code: "ERR_OKF_FIELD",
    path: "fatal.md",
    field: "type",
    message: "Invalid OKF field: fatal.md (type)",
  }],
});

const direct = api.createOkfSearch([{
  path: "direct.md",
  markdown: "---\\ntype: direct\\n---\\npackeddirectneedle",
}]);
assert.equal(direct instanceof Promise, false);
assert.equal(direct.search("packeddirectneedle").length, 1);
assert.throws(
  () => direct.ingest(fatalInput),
  (error) => {
    assert.equal(error instanceof Error, true);
    assert.equal(error instanceof api.OkfError, true);
    assert.equal(error.name, "OkfError");
    assert.equal(error.code, "ERR_OKF_FIELD");
    assert.equal(error.path, "fatal.md");
    assert.equal(error.field, "type");
    assert.equal(error.message, "Invalid OKF field: fatal.md (type)");
    assert.equal(Object.hasOwn(error, "field"), true);
    return true;
  },
);
assert.equal(
  direct.search("packeddirectneedle").length,
  1,
  "preparation failure made the packed handle unusable",
);

const root = join(process.cwd(), "fixture");
const okf = await api.openOkf(root);
assert.equal(typeof okf.listDegradedDocuments, "function");
assert.equal(typeof okf.listTypes, "function");
assert.deepEqual(okf.listTypes(), ["note"]);
const ingestResult = okf.ingest({
  path: "consumer.md",
  markdown: "---\\ntype: packed\\n---\\npackedremovalneedle",
});
assert.deepEqual(Object.keys(ingestResult), ["conformance", "document"]);
assert.equal(ingestResult.conformance, "strict");
assert.equal(ingestResult.document.status, "stable");
assert.equal(typeof okf.autoSuggest, "function");
const suggestions = okf.autoSuggest("packedremovalneedle");
assert.equal(suggestions.length, 1);
assert.deepEqual(Object.keys(suggestions[0]).sort(), [
  "score",
  "suggestion",
  "terms",
]);
assert.equal(suggestions[0].suggestion, "packedremovalneedle");
assert.deepEqual(suggestions[0].terms, ["packedremovalneedle"]);
assert.equal(typeof suggestions[0].score, "number");
assert.ok(suggestions[0].score > 0);
assert.equal(Object.hasOwn(suggestions[0], "documentId"), false);
assert.deepEqual(okf.listTypes(), ["note", "packed"]);
assert.equal(Object.isFrozen(okf.listTypes()), true);
assert.equal(Object.hasOwn(ingestResult, "records"), false);
assert.equal(Object.hasOwn(ingestResult, "diagnostics"), false);

const degradedInput = {
  path: "degraded.md",
  markdown: "---\\ntype: degraded\\ntitle: 1\\n---\\ndegradedremovalneedle",
};
const degradedValidation = api.validateOkfDocument(degradedInput);
assert.equal(degradedValidation.isValid, false);
assert.equal(degradedValidation.isIndexable, true);
assert.deepEqual(degradedValidation.errors, [{
  code: "ERR_OKF_FIELD",
  path: "degraded.md",
  field: "title",
  message: "Invalid OKF field: degraded.md (title)",
}]);
const degradedResult = okf.ingest(degradedInput);
assert.deepEqual(Object.keys(degradedResult), [
  "conformance",
  "documentId",
  "path",
  "diagnostics",
]);
assert.equal(degradedResult.conformance, "degraded");
assert.equal(degradedResult.documentId, "degraded");
assert.equal(degradedResult.path, "degraded.md");
assert.equal(Object.hasOwn(degradedResult, "document"), false);
assert.deepEqual(degradedResult.diagnostics, degradedValidation.errors);
const degradedInventory = okf.listDegradedDocuments();
assert.deepEqual(degradedInventory, [{
  documentId: "degraded",
  path: "degraded.md",
  diagnostics: degradedResult.diagnostics,
}]);
const degradedHits = okf.search("degradedremovalneedle", {
  where: { conformance: ["degraded"] },
});
assert.equal(degradedHits.length, 1);
assert.equal(degradedHits[0].conformance, "degraded");
assert.deepEqual(okf.search("degradedremovalneedle", {
  where: { conformance: ["strict"] },
}), []);
assert.equal(typeof okf.remove, "function");
const strictHits = okf.search("packedremovalneedle", {
  boost: { body: 2 },
  where: { conformance: ["strict"] },
});
assert.equal(strictHits.length, 1);
assert.equal(strictHits[0].conformance, "strict");
assert.equal(okf.search("packedremovalneedle").length, 1);
assert.equal(okf.remove("./degraded.md"), true);
assert.deepEqual(okf.listDegradedDocuments(), []);
assert.deepEqual(okf.search("degradedremovalneedle"), []);
assert.equal(okf.remove("./consumer.md"), true);
assert.deepEqual(okf.listTypes(), ["note"]);
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

async function inspectLibraryManifest(libraryTarball, extractionRoot) {
  await mkdir(extractionRoot, { recursive: true });
  run("tar", ["-xzf", libraryTarball, "-C", extractionRoot]);

  const manifest = JSON.parse(
    await readFile(join(extractionRoot, "package", "package.json"), "utf8"),
  );
  assert.equal(manifest.main, "./dist/index.js");
  assert.equal(manifest.types, "./dist/index.d.ts");
  assert.equal(manifest.jsdelivr, "./dist/browser.min.js");
  assert.equal(manifest.unpkg, "./dist/browser.min.js");
  assert.deepEqual(Object.keys(manifest.exports["."]), ["node", "default"]);
  assert.deepEqual(manifest.exports["."], {
    node: {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    },
    default: {
      types: "./dist/browser.d.ts",
      import: "./dist/browser.js",
    },
  });

  const browserBundle = await readFile(
    join(extractionRoot, "package", "dist", "browser.min.js"),
    "utf8",
  );
  assert.equal(
    /["']node:/.test(browserBundle),
    false,
    "browser global bundle contains a node: import",
  );
  await scanPackedPackage(extractionRoot, packageNames.library);

  const context = {
    document: {
      createElement: () => ({
        textContent: "",
        set innerHTML(value) {
          this.textContent = value;
        },
      }),
    },
  };
  runInNewContext(browserBundle, context);
  assert.deepEqual(Object.keys(context.OkfMiniSearch).sort(), [
    "OkfError",
    "createOkfSearch",
    "openOkf",
    "validateOkfDocument",
  ]);
  const okf = context.OkfMiniSearch.createOkfSearch([{
    path: "cdn.md",
    markdown: "---\ntype: guide\n---\ncdnsearchneedle",
  }]);
  assert.equal(okf.search("cdnsearchneedle").length, 1);
}

async function inspectPiManifest(
  piTarball,
  extractionRoot,
  expectedLibraryRange,
) {
  await mkdir(extractionRoot, { recursive: true });
  run("tar", ["-xzf", piTarball, "-C", extractionRoot]);

  const manifestPath = join(extractionRoot, "package", "package.json");
  const serialized = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(serialized);

  await scanPackedPackage(extractionRoot, packageNames.pi);

  assert.deepEqual(manifest.files, ["extensions"]);
  assert.deepEqual(manifest.scripts, {
    typecheck: "tsc -p tsconfig.test.json",
    test: "vitest run",
  });
  assert.deepEqual(manifest.pi, {
    extensions: ["./extensions/okf-search"],
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

async function inspectNativeManifest(nativeTarball, extractionRoot) {
  await mkdir(extractionRoot, { recursive: true });
  run("tar", ["-xzf", nativeTarball, "-C", extractionRoot]);

  const manifestPath = join(extractionRoot, "package", "package.json");
  const serialized = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(serialized);
  const hostArtifact = currentNativeArtifact();

  await scanPackedPackage(extractionRoot, packageNames.native);

  assert.equal(manifest.name, packageNames.native);
  assert.equal(manifest.main, "./index.js");
  assert.equal(manifest.types, "./index.d.ts");
  assert.deepEqual(manifest.exports, {
    ".": {
      types: "./index.d.ts",
      require: "./index.js",
      import: "./index.js",
      default: "./index.js",
    },
  });
  assert.deepEqual(manifest.files, [
    "index.js",
    "index.d.ts",
    "okf-search-native.*.node",
  ]);
  assert.equal(manifest.engines?.node, ">=22.19.0");
  assert.equal(Object.hasOwn(manifest, "type"), false);
  assert.equal(serialized.includes("workspace:"), false);
  assert.equal(manifest.napi?.binaryName, packageNames.native);
  assert.deepEqual(manifest.napi?.targets, [
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
    "x86_64-pc-windows-msvc",
    "x86_64-unknown-linux-gnu",
  ]);

  await access(join(extractionRoot, "package", "index.js"));
  await access(join(extractionRoot, "package", "index.d.ts"));
  await access(join(extractionRoot, "package", hostArtifact));
}

async function prepareConsumerRoot(consumerRoot, manifest) {
  await mkdir(consumerRoot, { recursive: true });
  await writeJson(join(consumerRoot, "package.json"), {
    ...manifest,
    private: true,
    type: "module",
    packageManager: "pnpm@11.22.0",
  });
  await writeFile(
    join(consumerRoot, "private-resolution.mjs"),
    privateResolutionConsumer,
  );
}

async function prepareLibraryConsumer(temporaryRoot, libraryTarball) {
  const consumerRoot = join(temporaryRoot, "library-consumer");
  await prepareConsumerRoot(consumerRoot, {
    name: "okf-minisearch-packed-consumer",
    dependencies: {
      "okf-minisearch": `file:../tarballs/${basename(libraryTarball)}`,
    },
  });
  await mkdir(join(consumerRoot, "fixture"));
  await writeFile(join(consumerRoot, "consumer.mts"), typeConsumer);
  await writeFile(
    join(consumerRoot, "browser-consumer.ts"),
    browserTypeConsumer,
  );
  await writeFile(
    join(consumerRoot, "browser-runtime.mjs"),
    browserRuntimeConsumer,
  );
  await writeFile(
    join(consumerRoot, "node-bundle.mjs"),
    nodeBundleConsumer,
  );
  await writeFile(join(consumerRoot, "runtime.mjs"), runtimeConsumer);
  await writeJson(join(consumerRoot, "tsconfig.json"), {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022"],
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
  await writeJson(join(consumerRoot, "tsconfig.browser.json"), {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM"],
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: [],
    },
    include: ["browser-consumer.ts"],
  });
  await writeFile(
    join(consumerRoot, "fixture", "marker.md"),
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
  return consumerRoot;
}

async function prepareNativeConsumer(temporaryRoot, nativeTarball) {
  const consumerRoot = join(temporaryRoot, "native-consumer");
  await prepareConsumerRoot(consumerRoot, {
    name: "okf-search-native-packed-consumer",
    dependencies: {
      "okf-search-native": `file:../tarballs/${basename(nativeTarball)}`,
    },
  });
  await writeFile(join(consumerRoot, "native-consumer.mts"), nativeTypeConsumer);
  await writeFile(join(consumerRoot, "native-runtime.mjs"), nativeRuntimeConsumer);
  await writeJson(join(consumerRoot, "native-tsconfig.json"), {
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
    include: ["native-consumer.mts"],
  });
  return consumerRoot;
}

async function preparePiConsumer(
  temporaryRoot,
  libraryTarball,
  piTarball,
  libraryVersion,
) {
  const consumerRoot = join(temporaryRoot, "pi-consumer");
  const librarySpecifier = `file:../tarballs/${basename(libraryTarball)}`;
  await prepareConsumerRoot(consumerRoot, {
    name: "pi-okf-search-packed-consumer",
    dependencies: {
      "okf-minisearch": librarySpecifier,
      "pi-okf-search": `file:../tarballs/${basename(piTarball)}`,
      "@earendil-works/pi-ai": "0.84.3",
      "@earendil-works/pi-coding-agent": "0.84.3",
      typebox: "1.3.7",
    },
  });
  await writeFile(
    join(consumerRoot, "pnpm-workspace.yaml"),
    ["overrides:", `  okf-minisearch: ${librarySpecifier}`, ""].join("\n"),
  );
  const agentDir = join(consumerRoot, "agent");
  const fixtureDir = join(consumerRoot, "fixture");
  await mkdir(agentDir);
  await mkdir(fixtureDir);
  await writeFile(join(consumerRoot, "smoke.mjs"), smokeConsumer(libraryVersion));
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
    packages: [join(consumerRoot, "node_modules", "pi-okf-search")],
    "pi-okf-search": { root: "../fixture" },
  });
  return consumerRoot;
}

async function checkPrivatePackageBoundary(consumerRoot) {
  await assert.rejects(
    access(join(consumerRoot, "node_modules", PRIVATE_PACKAGE_NAME)),
    (error) => error?.code === "ENOENT",
    `${PRIVATE_PACKAGE_NAME} exists in ${basename(consumerRoot)} dependency tree`,
  );

  run(process.execPath, ["private-resolution.mjs"], { cwd: consumerRoot });
  const productionTree = run(
    pnpm,
    ["list", "--prod", "--depth", "Infinity", "--json"],
    { cwd: consumerRoot, capture: true },
  );
  for (const marker of FORBIDDEN_PACKED_MARKERS) {
    assert.equal(
      productionTree.includes(marker),
      false,
      `${basename(consumerRoot)} production dependency tree contains ${marker}`,
    );
  }
}

function checkLibraryConsumer(consumerRoot) {
  const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
  run(
    process.execPath,
    [tsc, "--project", "tsconfig.json", "--pretty", "false"],
    { cwd: consumerRoot },
  );
  run(
    process.execPath,
    [tsc, "--project", "tsconfig.browser.json", "--pretty", "false"],
    { cwd: consumerRoot },
  );
  run(process.execPath, ["runtime.mjs"], { cwd: consumerRoot });
}

function normalizedModuleIds(ids) {
  return ids.map((id) => id.replaceAll("\\\\", "/"));
}

function assertBranch(ids, selected, excluded, label) {
  const modules = normalizedModuleIds(ids);
  assert.ok(
    modules.some((id) => id.endsWith(`/okf-minisearch/dist/${selected}`)),
    `${label} did not select dist/${selected}`,
  );
  assert.equal(
    modules.some((id) => id.endsWith(`/okf-minisearch/dist/${excluded}`)),
    false,
    `${label} unexpectedly selected dist/${excluded}`,
  );
}

async function checkEsbuildConsumers(consumerRoot) {
  const outputRoot = join(consumerRoot, ".bundles");
  await mkdir(outputRoot);
  const browserOutput = join(outputRoot, "browser.mjs");
  const browser = await esbuild({
    entryPoints: [join(consumerRoot, "browser-runtime.mjs")],
    bundle: true,
    format: "esm",
    metafile: true,
    outfile: browserOutput,
    platform: "browser",
    target: "es2022",
  });
  assertBranch(
    Object.keys(browser.metafile.inputs),
    "browser.js",
    "index.js",
    "esbuild browser bundle",
  );
  const browserCode = await readFile(browserOutput, "utf8");
  assert.equal(
    /["']node:/.test(browserCode),
    false,
    "esbuild browser bundle contains a node: import",
  );
  const browserRunner = join(outputRoot, "run-browser.mjs");
  await writeFile(browserRunner, `globalThis.document = {
  createElement: () => ({
    textContent: "",
    set innerHTML(value) { this.textContent = value; },
  }),
};
await import(${JSON.stringify(browserOutput)});
`);
  run(process.execPath, [browserRunner], { cwd: consumerRoot });

  const node = await esbuild({
    entryPoints: [join(consumerRoot, "node-bundle.mjs")],
    bundle: true,
    format: "esm",
    metafile: true,
    outfile: join(outputRoot, "node.mjs"),
    platform: "node",
    target: "node20",
  });
  assertBranch(
    Object.keys(node.metafile.inputs),
    "index.js",
    "browser.js",
    "esbuild Node bundle",
  );
}

async function rollupModuleIds(input, exportConditions) {
  const bundle = await rollup({
    input,
    external(id) {
      return id !== packageNames.library &&
        !id.startsWith(".") &&
        !isAbsolute(id);
    },
    plugins: [nodeResolve({ exportConditions })],
    onwarn(warning) {
      throw new Error(`Rollup warning: ${warning.message}`);
    },
  });

  try {
    const generated = await bundle.generate({ format: "esm" });
    return generated.output.flatMap((item) =>
      item.type === "chunk" ? Object.keys(item.modules) : []);
  } finally {
    await bundle.close();
  }
}

async function checkRollupConsumers(consumerRoot) {
  const defaultModules = await rollupModuleIds(
    join(consumerRoot, "browser-runtime.mjs"),
    [],
  );
  assertBranch(
    defaultModules,
    "browser.js",
    "index.js",
    "Rollup default-condition bundle",
  );
  assert.equal(
    normalizedModuleIds(defaultModules).some((id) => id.startsWith("node:")),
    false,
    "Rollup default-condition graph contains a Node built-in",
  );

  const nodeModules = await rollupModuleIds(
    join(consumerRoot, "node-bundle.mjs"),
    ["node"],
  );
  assertBranch(
    nodeModules,
    "open-okf.js",
    "browser.js",
    "Rollup Node-condition bundle",
  );
}

function checkNativeConsumer(consumerRoot) {
  run(
    process.execPath,
    [
      join(root, "node_modules", "typescript", "bin", "tsc"),
      "--project",
      "native-tsconfig.json",
      "--pretty",
      "false",
    ],
    { cwd: consumerRoot },
  );
  run(process.execPath, ["native-runtime.mjs"], { cwd: consumerRoot });
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
    const nativePackage = await packPackage("native", tarballRoot, temporaryRoot);
    const libraryManifest = JSON.parse(
      await readFile(join(packageRoots.library, "package.json"), "utf8"),
    );
    const libraryVersion = libraryManifest.version;
    assert.equal(typeof libraryVersion, "string");
    assert.ok(libraryVersion.length > 0);
    const piSourceManifest = JSON.parse(
      await readFile(join(packageRoots.pi, "package.json"), "utf8"),
    );
    const expectedLibraryRange =
      piSourceManifest.dependencies?.[packageNames.library]?.replace(
        /^workspace:/,
        "",
      );
    assert.equal(typeof expectedLibraryRange, "string");
    assert.ok(expectedLibraryRange.length > 0);

    await inspectLibraryManifest(
      libraryPackage.tarball,
      join(temporaryRoot, "extracted", "library"),
    );
    await inspectPiManifest(
      piPackage.tarball,
      join(temporaryRoot, "extracted", "pi"),
      expectedLibraryRange,
    );
    await inspectNativeManifest(
      nativePackage.tarball,
      join(temporaryRoot, "extracted", "native"),
    );
    const libraryConsumerRoot = await prepareLibraryConsumer(
      temporaryRoot,
      libraryPackage.tarball,
    );
    const nativeConsumerRoot = await prepareNativeConsumer(
      temporaryRoot,
      nativePackage.tarball,
    );
    const piConsumerRoot = await preparePiConsumer(
      temporaryRoot,
      libraryPackage.tarball,
      piPackage.tarball,
      libraryVersion,
    );

    for (const consumerRoot of [
      libraryConsumerRoot,
      nativeConsumerRoot,
      piConsumerRoot,
    ]) {
      run(
        pnpm,
        ["install", "--ignore-scripts", "--no-frozen-lockfile"],
        { cwd: consumerRoot },
      );
      await checkPrivatePackageBoundary(consumerRoot);
    }

    checkLibraryConsumer(libraryConsumerRoot);
    await checkEsbuildConsumers(libraryConsumerRoot);
    await checkRollupConsumers(libraryConsumerRoot);
    checkNativeConsumer(nativeConsumerRoot);
    run(process.execPath, ["smoke.mjs"], { cwd: piConsumerRoot });

    console.log(
      `\nPacked packages passed manifest, install, Node/browser TypeScript, runtime, esbuild, Rollup, and Pi loader checks: ${relative(root, packageRoots.library)}, ${relative(root, packageRoots.pi)}, ${relative(root, packageRoots.native)}`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
