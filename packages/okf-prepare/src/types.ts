export type IsoDateTime = string;

export type OkfStatus = "draft" | "stable" | "deprecated";

export type OkfTrustTier =
  | "unverified"
  | "machine-confirmed"
  | "human-reviewed";

export type OkfConformance = "strict" | "degraded";

export interface OkfDocumentInput {
  readonly path: string;
  readonly markdown: string;
}

export interface OkfDocumentIdentity {
  readonly path: string;
  readonly documentId: string;
}

export type OkfDiagnosticCode = "ERR_OKF_PARSE" | "ERR_OKF_FIELD";

export interface OkfDiagnostic {
  readonly code: OkfDiagnosticCode;
  readonly path: string;
  readonly field?: string;
  readonly message: string;
}

export type NonEmptyDiagnostics = readonly [
  OkfDiagnostic,
  ...OkfDiagnostic[],
];

export interface OkfTimeWindow {
  from: IsoDateTime;
  to: IsoDateTime;
}

export interface OkfSource {
  id?: string;
  resource: string;
  title?: string;
  author?: string;
  usageCount?: number;
  lastModified?: IsoDateTime;
  usageWindow?: OkfTimeWindow;
}

export interface OkfGeneration {
  by: string;
  at?: IsoDateTime;
}

export interface OkfVerification {
  by: string;
  at: IsoDateTime;
}

export interface OkfParameter {
  name: string;
  type: string;
  required: boolean;
}

export interface OkfExecutor {
  resource: string;
  receipt: string[];
}

export interface OkfAttester {
  resource: string;
}

export interface OkfDocument {
  id: string;
  type: string;
  title: string;
  description?: string;
  resource?: string;
  tags: string[];
  sources: OkfSource[];
  usageWindow?: OkfTimeWindow;
  generated?: OkfGeneration;
  verified: OkfVerification[];
  status: OkfStatus;
  staleAfter?: IsoDateTime;
  runtime?: string;
  parameters?: OkfParameter[];
  computation?: string;
  executor?: OkfExecutor;
  attester?: OkfAttester;
  body: string;
  extensions: Record<string, unknown>;
}

export interface PreparedOkfMetadata {
  readonly title: string;
  readonly description?: string;
  readonly resource?: string;
  readonly tags: readonly string[];
  readonly sourceText: string;
}

export type PreparedOkfStatusFacet =
  | { readonly classified: true; readonly value: OkfStatus }
  | { readonly classified: false; readonly value?: never };

export type PreparedOkfTrustFacet =
  | { readonly classified: true; readonly value: OkfTrustTier }
  | { readonly classified: false; readonly value?: never };

export type PreparedOkfStalenessFacet =
  | {
      readonly classified: false;
      readonly staleAfter?: never;
      readonly staleAfterEpoch?: never;
    }
  | {
      readonly classified: true;
      readonly staleAfter?: never;
      readonly staleAfterEpoch?: never;
    }
  | {
      readonly classified: true;
      readonly staleAfter: IsoDateTime;
      readonly staleAfterEpoch: number;
    };

export interface StrictPreparedOkfFacets {
  readonly status: Extract<PreparedOkfStatusFacet, { classified: true }>;
  readonly trust: Extract<PreparedOkfTrustFacet, { classified: true }>;
  readonly staleness: Exclude<
    PreparedOkfStalenessFacet,
    { classified: false }
  >;
}

export interface DegradedPreparedOkfFacets {
  readonly status: PreparedOkfStatusFacet;
  readonly trust: PreparedOkfTrustFacet;
  readonly staleness: PreparedOkfStalenessFacet;
}

export interface PreparedOkfSection {
  readonly id: string;
  readonly headingPath: string;
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
}

export type NonEmptyPreparedOkfSections = readonly [
  PreparedOkfSection,
  ...PreparedOkfSection[],
];

export type OkfValidationResult =
  | {
      readonly isValid: true;
      readonly isIndexable: true;
      readonly errors: readonly [];
    }
  | {
      readonly isValid: false;
      readonly isIndexable: true;
      readonly errors: NonEmptyDiagnostics;
    }
  | {
      readonly isValid: false;
      readonly isIndexable: false;
      readonly errors: NonEmptyDiagnostics;
    };

export type PreparedOkfDocument =
  | {
      readonly conformance: "strict";
      readonly identity: OkfDocumentIdentity;
      readonly type: string;
      readonly metadata: PreparedOkfMetadata;
      readonly facets: StrictPreparedOkfFacets;
      readonly sections: NonEmptyPreparedOkfSections;
      readonly diagnostics: readonly [];
      readonly document: OkfDocument;
    }
  | {
      readonly conformance: "degraded";
      readonly identity: OkfDocumentIdentity;
      readonly type: string;
      readonly metadata: PreparedOkfMetadata;
      readonly facets: DegradedPreparedOkfFacets;
      readonly sections: NonEmptyPreparedOkfSections;
      readonly diagnostics: NonEmptyDiagnostics;
      readonly document?: never;
    };
