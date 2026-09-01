import type {
  DegradedPreparedOkfFacets,
  NonEmptyDiagnostics,
  NonEmptyPreparedOkfSections,
  OkfDiagnostic,
  OkfDocument,
  OkfDocumentIdentity,
  OkfStatus,
  OkfTrustTier,
  PreparedOkfDocument,
  PreparedOkfMetadata,
  PreparedOkfSection,
  StrictPreparedOkfFacets,
} from "@okf-internal/prepare";

// @ts-expect-error MiniSearch record types are not private preparation exports
import type { OkfIndexRecord } from "@okf-internal/prepare";
// @ts-expect-error MiniSearch projection types are not private preparation exports
import type { OkfIndexProjection } from "@okf-internal/prepare";

const diagnostic: OkfDiagnostic = {
  code: "ERR_OKF_FIELD",
  path: "note.md",
  field: "title",
  message: "Invalid OKF field: note.md (title)",
};
const diagnostics: NonEmptyDiagnostics = [diagnostic];
const identity: OkfDocumentIdentity = {
  path: "note.md",
  documentId: "note",
};
const metadata: PreparedOkfMetadata = {
  title: "Note",
  tags: [],
  sourceText: "",
};
const section: PreparedOkfSection = {
  id: "note#root",
  headingPath: "Note",
  text: "",
  startLine: 4,
  endLine: 4,
};
const sections: NonEmptyPreparedOkfSections = [section];
const strictFacets: StrictPreparedOkfFacets = {
  status: { classified: true, value: "stable" },
  trust: { classified: true, value: "unverified" },
  staleness: { classified: true },
};
const degradedFacets: DegradedPreparedOkfFacets = {
  status: { classified: false },
  trust: { classified: false },
  staleness: { classified: false },
};

declare const document: OkfDocument;

declare const strict: PreparedOkfDocument;
if (strict.conformance === "strict") {
  const status: OkfStatus = strict.facets.status.value;
  const trust: OkfTrustTier = strict.facets.trust.value;
  void status;
  void trust;
  void strict.document;
}

declare const degraded: PreparedOkfDocument;
if (degraded.conformance === "degraded") {
  const errors: NonEmptyDiagnostics = degraded.diagnostics;
  void errors;
}

const validStrict: PreparedOkfDocument = {
  conformance: "strict",
  identity,
  type: "note",
  metadata,
  facets: strictFacets,
  sections,
  diagnostics: [],
  document,
};
void validStrict;

const strictWithRecords: PreparedOkfDocument = {
  conformance: "strict",
  identity,
  type: "note",
  metadata,
  facets: strictFacets,
  sections,
  diagnostics: [],
  document,
  // @ts-expect-error prepared values do not expose backend records
  records: [],
};
void strictWithRecords;

const validDegraded: PreparedOkfDocument = {
  conformance: "degraded",
  identity,
  type: "note",
  metadata,
  facets: degradedFacets,
  sections,
  diagnostics,
};
void validDegraded;

// @ts-expect-error strict values cannot carry diagnostics
const strictWithDiagnostics: PreparedOkfDocument = {
  conformance: "strict",
  identity,
  type: "note",
  metadata,
  facets: strictFacets,
  sections,
  diagnostics,
  document,
};
void strictWithDiagnostics;

// @ts-expect-error strict values require a detached document
const strictWithoutDocument: PreparedOkfDocument = {
  conformance: "strict",
  identity,
  type: "note",
  metadata,
  facets: strictFacets,
  sections,
  diagnostics: [],
};
void strictWithoutDocument;

const strictWithUnclassifiedStatus: StrictPreparedOkfFacets = {
  // @ts-expect-error strict status must be classified
  status: { classified: false },
  trust: { classified: true, value: "unverified" },
  staleness: { classified: true },
};
void strictWithUnclassifiedStatus;

const strictWithUnclassifiedTrust: StrictPreparedOkfFacets = {
  status: { classified: true, value: "stable" },
  // @ts-expect-error strict trust must be classified
  trust: { classified: false },
  staleness: { classified: true },
};
void strictWithUnclassifiedTrust;

const strictWithUnclassifiedStaleness: StrictPreparedOkfFacets = {
  status: { classified: true, value: "stable" },
  trust: { classified: true, value: "unverified" },
  // @ts-expect-error strict staleness must be classified
  staleness: { classified: false },
};
void strictWithUnclassifiedStaleness;

const strictWithHalfStaleTimestamp: StrictPreparedOkfFacets = {
  status: { classified: true, value: "stable" },
  trust: { classified: true, value: "unverified" },
  // @ts-expect-error a stale timestamp requires both text and epoch
  staleness: { classified: true, staleAfter: "2026-01-01T00:00:00Z" },
};
void strictWithHalfStaleTimestamp;

// @ts-expect-error degraded values require at least one diagnostic
const degradedWithoutDiagnostics: PreparedOkfDocument = {
  conformance: "degraded",
  identity,
  type: "note",
  metadata,
  facets: degradedFacets,
  sections,
  diagnostics: [],
};
void degradedWithoutDiagnostics;

// @ts-expect-error degraded values cannot carry a document
const degradedWithDocument: PreparedOkfDocument = {
  conformance: "degraded",
  identity,
  type: "note",
  metadata,
  facets: degradedFacets,
  sections,
  diagnostics,
  document,
};
void degradedWithDocument;

const strictWithoutSections: PreparedOkfDocument = {
  conformance: "strict",
  identity,
  type: "note",
  metadata,
  facets: strictFacets,
  // @ts-expect-error a prepared value always has at least one section
  sections: [],
  diagnostics: [],
  document,
};
void strictWithoutSections;

const degradedWithoutSections: PreparedOkfDocument = {
  conformance: "degraded",
  identity,
  type: "note",
  metadata,
  facets: degradedFacets,
  // @ts-expect-error a prepared value always has at least one section
  sections: [],
  diagnostics,
};
void degradedWithoutSections;

const readDiagnostic: OkfDiagnostic = {
  // @ts-expect-error read failures are loader errors, not document diagnostics
  code: "ERR_OKF_READ",
  path: "note.md",
  message: "Cannot read OKF path: note.md",
};
void readDiagnostic;
