export { PrepareError } from "./errors.js";
export type {
  PrepareErrorCode,
  PrepareErrorOptions,
} from "./errors.js";
export { normalizeOkfDocumentIdentity } from "./identity.js";
export {
  prepareOkfDocument,
  prepareOkfDocuments,
  validateOkfDocument,
} from "./prepare.js";
export {
  isOkfConformance,
  isOkfStatus,
  isOkfTrustTier,
} from "./vocabulary.js";

export type {
  DegradedPreparedOkfFacets,
  IsoDateTime,
  NonEmptyDiagnostics,
  NonEmptyPreparedOkfSections,
  OkfAttester,
  OkfConformance,
  OkfDiagnostic,
  OkfDiagnosticCode,
  OkfDocument,
  OkfDocumentIdentity,
  OkfDocumentInput,
  OkfExecutor,
  OkfGeneration,
  OkfParameter,
  OkfSource,
  OkfStatus,
  OkfTimeWindow,
  OkfTrustTier,
  OkfValidationResult,
  OkfVerification,
  PreparedOkfDocument,
  PreparedOkfMetadata,
  PreparedOkfSection,
  PreparedOkfStalenessFacet,
  PreparedOkfStatusFacet,
  PreparedOkfTrustFacet,
  StrictPreparedOkfFacets,
} from "./types.js";

export interface PrepareBundleSentinel {
  readonly marker: "okf-prepare-bundled";
  readonly value: 73;
}

export function createPrepareBundleSentinel(): PrepareBundleSentinel {
  return { marker: "okf-prepare-bundled", value: 73 };
}
