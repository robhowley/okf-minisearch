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
  OkfDiagnostic,
  OkfDiagnosticCode,
  OkfDocument,
  OkfDocumentInput,
  OkfErrorCode,
  OkfIngestResult,
  OkfSearch,
  OkfSearchField,
  OkfSearchOptions,
  OkfStatus,
  OkfValidationResult,
} from "../src/index.js";

type Same<T, U> =
  (<V>() => V extends T ? 1 : 2) extends
  (<V>() => V extends U ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type ExactOkfValidationResult = Assert<Same<
  OkfValidationResult,
  {
    readonly isValid: boolean;
    readonly errors: readonly OkfDiagnostic[];
  }
>>;
type ExactOkfIngestResult = Assert<Same<
  OkfIngestResult,
  { document: OkfDocument }
>>;
type ExactOkfDocumentStatus = Assert<Same<
  OkfDocument["status"],
  OkfStatus
>>;
type ExactOkfRemove = Assert<Same<
  OkfSearch["remove"],
  (path: string) => boolean
>>;
type ExactOkfSearchBoost = Assert<Same<
  OkfSearchOptions["boost"],
  Readonly<Partial<Record<OkfSearchField, number>>> | undefined
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
void [
  validate,
  validation,
  diagnosticCode,
  unusableCode,
  unusableDiagnostic,
  null as unknown as ExactOkfErrorCode,
  null as unknown as ExactOkfDiagnosticCode,
  null as unknown as ExactOkfValidationResult,
  null as unknown as ExactOkfIngestResult,
  null as unknown as ExactOkfDocumentStatus,
  null as unknown as ExactOkfRemove,
  null as unknown as ExactOkfSearchBoost,
];

void (undefined as unknown as OkfBundle | OkfReservedFile | OkfIndexRecord);

const booleanFuzzy: OkfSearchOptions = {
  fuzzy: true,
};
// @ts-expect-error Fuzzy search does not accept a numeric ratio.
const numericFuzzy: OkfSearchOptions = { fuzzy: 0.2 };
// @ts-expect-error Fuzzy search only accepts a boolean.
const stringFuzzy: OkfSearchOptions = { fuzzy: "true" };

void [booleanFuzzy, numericFuzzy, stringFuzzy];

const readonlyBoosts = { title: 1.5, body: 2 } as const;
const readonlySearchOptions: OkfSearchOptions = {
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

void [
  readonlyBoosts,
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
