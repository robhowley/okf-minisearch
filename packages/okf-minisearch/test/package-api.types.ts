// These types remain internal to the package implementation and must not be
// importable from the supported package root.
// @ts-expect-error OkfBundle is not part of the package root API.
import type { OkfBundle } from "../src/index.js";
// @ts-expect-error OkfReservedFile is not part of the package root API.
import type { OkfReservedFile } from "../src/index.js";
import { validateOkfDocument } from "../src/index.js";
import type {
  OkfDiagnostic,
  OkfDiagnosticCode,
  OkfDocumentInput,
  OkfSearchField,
  OkfSearchOptions,
} from "../src/index.js";

const validate: (
  input: OkfDocumentInput,
) => readonly OkfDiagnostic[] = validateOkfDocument;
const diagnosticCode: OkfDiagnosticCode = "ERR_OKF_PARSE";
void [validate, diagnosticCode];

void (undefined as unknown as OkfBundle | OkfReservedFile);

const booleanFuzzy: OkfSearchOptions = {
  fuzzy: true,
};
// @ts-expect-error Fuzzy search does not accept a numeric ratio.
const numericFuzzy: OkfSearchOptions = { fuzzy: 0.2 };
// @ts-expect-error Fuzzy search only accepts a boolean.
const stringFuzzy: OkfSearchOptions = { fuzzy: "true" };

void [booleanFuzzy, numericFuzzy, stringFuzzy];

// @ts-expect-error MiniSearch's internal field name is not public.
const internalHeading: OkfSearchField = "headingPath";
// @ts-expect-error MiniSearch's internal field name is not public.
const internalBody: OkfSearchField = "text";

void (internalHeading as OkfSearchField);
void (internalBody as OkfSearchField);
