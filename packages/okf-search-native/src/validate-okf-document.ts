import { validateOkfDocument as validatePreparedDocument } from "@okf-internal/prepare";

import type {
  OkfDocumentInput,
  OkfValidationResult,
} from "./types.js";

export function validateOkfDocument(
  input: OkfDocumentInput,
): OkfValidationResult {
  const result = validatePreparedDocument(input);

  if (result.errors.length === 0) {
    return {
      isValid: true,
      isIndexable: true,
      errors: [],
    };
  }

  const [first, ...rest] = result.errors.map((error) => ({ ...error }));
  if (!first) {
    throw new Error("Invalid OKF validation results must contain a diagnostic");
  }

  return result.isIndexable
    ? {
        isValid: false,
        isIndexable: true,
        errors: [first, ...rest],
      }
    : {
        isValid: false,
        isIndexable: false,
        errors: [first, ...rest],
      };
}
