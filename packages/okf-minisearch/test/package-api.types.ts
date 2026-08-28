// These types remain internal to the package implementation and must not be
// importable from the supported package root.
// @ts-expect-error OkfBundle is not part of the package root API.
import type { OkfBundle } from "../src/index.js";
// @ts-expect-error OkfReservedFile is not part of the package root API.
import type { OkfReservedFile } from "../src/index.js";
// @ts-expect-error OkfIndexRecord is not part of the package root API.
import type { OkfIndexRecord } from "../src/index.js";
import { validateOkfDocument } from "../src/index.js";
import type {
  OkfConformance,
  OkfDiagnostic,
  OkfDiagnosticCode,
  OkfDegradedDocument,
  OkfDocument,
  OkfDocumentInput,
  OkfErrorCode,
  OkfIngestResult,
  OkfSearch,
  OkfSearchField,
  OkfSearchHit,
  OkfSearchOptions,
  OkfStatus,
  OkfValidationResult,
} from "../src/index.js";

type Same<T, U> =
  (<V>() => V extends T ? 1 : 2) extends
  (<V>() => V extends U ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type ExactOkfConformance = Assert<Same<
  OkfConformance,
  "strict" | "degraded"
>>;
type ExactOkfValidationResult = Assert<Same<
  OkfValidationResult,
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
>>;
type ExactOkfDegradedDocument = Assert<Same<
  OkfDegradedDocument,
  {
    readonly documentId: string;
    readonly path: string;
    readonly diagnostics: readonly [OkfDiagnostic, ...OkfDiagnostic[]];
  }
>>;
type ExactOkfIngestResult = Assert<Same<
  OkfIngestResult,
  | {
      readonly conformance: "strict";
      readonly document: OkfDocument;
    }
  | ({ readonly conformance: "degraded" } & OkfDegradedDocument)
>>;
type ExactOkfDocumentStatus = Assert<Same<
  OkfDocument["status"],
  OkfStatus
>>;
type ExactOkfListDegradedDocuments = Assert<Same<
  OkfSearch["listDegradedDocuments"],
  () => readonly OkfDegradedDocument[]
>>;
type ExactOkfListTypes = Assert<Same<
  OkfSearch["listTypes"],
  () => readonly string[]
>>;
type ExactOkfRemove = Assert<Same<
  OkfSearch["remove"],
  (path: string) => boolean
>>;
type ExactOkfSearchBoost = Assert<Same<
  OkfSearchOptions["boost"],
  Readonly<Partial<Record<OkfSearchField, number>>> | undefined
>>;
type ExactOkfSearchOptionKeys = Assert<Same<
  keyof OkfSearchOptions,
  "limit" | "where" | "asOf" | "match" | "fields" | "boost" | "fuzzy"
>>;
type ExactOkfSearchWhereKeys = Assert<Same<
  keyof NonNullable<OkfSearchOptions["where"]>,
  "types" | "tagsAny" | "statuses" | "trustTiers" | "stale"
  | "conformance"
>>;
type ExactOkfSearchConformance = Assert<Same<
  NonNullable<OkfSearchOptions["where"]>["conformance"],
  readonly OkfConformance[] | undefined
>>;
type ExactOkfSearchHitKeys = Assert<Same<
  keyof OkfSearchHit,
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
>>;
type ExactOkfSearchHitConformance = Assert<Same<
  OkfSearchHit["conformance"],
  OkfConformance
>>;
type ExactOkfErrorCode = Assert<Same<
  OkfErrorCode,
  | "ERR_OKF_READ"
  | "ERR_OKF_PARSE"
  | "ERR_OKF_FIELD"
  | "ERR_OKF_INDEX_UNUSABLE"
>>;
type ExactOkfDiagnosticCode = Assert<Same<
  OkfDiagnosticCode,
  "ERR_OKF_PARSE" | "ERR_OKF_FIELD"
>>;

const validate: (
  input: OkfDocumentInput,
) => OkfValidationResult = validateOkfDocument;
const validation: OkfValidationResult = {
  isValid: true,
  isIndexable: true,
  errors: [],
};
// @ts-expect-error Validation result state is readonly.
validation.isValid = false;
// @ts-expect-error Validation errors are readonly.
validation.errors.push({
  code: "ERR_OKF_PARSE",
  path: "concept.md",
  message: "diagnostic",
});
const diagnosticCode: OkfDiagnosticCode = "ERR_OKF_PARSE";
const unusableCode: OkfErrorCode = "ERR_OKF_INDEX_UNUSABLE";
// @ts-expect-error Fatal handle state is not a document diagnostic.
const unusableDiagnostic: OkfDiagnosticCode = "ERR_OKF_INDEX_UNUSABLE";
const diagnostic: OkfDiagnostic = {
  code: "ERR_OKF_FIELD",
  path: "concept.md",
  field: "status",
  message: "diagnostic",
};
// @ts-expect-error Strict validation cannot contain diagnostics.
const strictWithErrors: OkfValidationResult = {
  isValid: true,
  isIndexable: true,
  errors: [diagnostic],
};
const degradedDocument: OkfDegradedDocument = {
  documentId: "concept",
  path: "concept.md",
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
void [
  validate,
  validation,
  diagnosticCode,
  unusableCode,
  unusableDiagnostic,
  diagnostic,
  degradedDocument,
  null as unknown as OkfConformance,
  null as unknown as ExactOkfConformance,
  null as unknown as ExactOkfErrorCode,
  null as unknown as ExactOkfDiagnosticCode,
  null as unknown as ExactOkfValidationResult,
  null as unknown as ExactOkfDegradedDocument,
  null as unknown as ExactOkfIngestResult,
  null as unknown as ExactOkfDocumentStatus,
  null as unknown as ExactOkfSearchOptionKeys,
  null as unknown as ExactOkfSearchWhereKeys,
  null as unknown as ExactOkfSearchConformance,
  null as unknown as ExactOkfSearchHitKeys,
  null as unknown as ExactOkfSearchHitConformance,
  null as unknown as ExactOkfListDegradedDocuments,
  null as unknown as ExactOkfListTypes,
  null as unknown as ExactOkfRemove,
  null as unknown as ExactOkfSearchBoost,
];

void (undefined as unknown as OkfBundle | OkfReservedFile | OkfIndexRecord);

const booleanFuzzy: OkfSearchOptions = {
  fuzzy: true,
};
const numericFuzzy: OkfSearchOptions = { fuzzy: 0.2 };
// @ts-expect-error Fuzzy search does not accept strings.
const stringFuzzy: OkfSearchOptions = { fuzzy: "true" };

void [booleanFuzzy, numericFuzzy, stringFuzzy];

const readonlyBoosts = { title: 1.5, body: 2 } as const;
const readonlyConformance = ["strict", "degraded"] as const;
const readonlySearchOptions: OkfSearchOptions = {
  boost: readonlyBoosts,
  where: { conformance: readonlyConformance },
};
// @ts-expect-error Conformance filters are readonly.
readonlySearchOptions.where?.conformance?.push("strict");
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

void [
  readonlyBoosts,
  readonlyConformance,
  readonlySearchOptions,
  internalHeadingBoost,
  internalSourceBoost,
  internalBodyBoost,
  stringBoost,
  nestedBoostOption,
];

// @ts-expect-error MiniSearch's internal field name is not public.
const internalHeading: OkfSearchField = "headingPath";
// @ts-expect-error MiniSearch's internal field name is not public.
const internalBody: OkfSearchField = "text";

void (internalHeading as OkfSearchField);
void (internalBody as OkfSearchField);
