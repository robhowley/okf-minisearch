import type {
  IsoDateTime,
  OkfDiagnostic,
  OkfDocument,
  OkfStatus,
  OkfTrustTier,
} from "./types.js";

export type OkfConformance = "strict" | "degraded";

export type NonEmptyDiagnostics = readonly [
  OkfDiagnostic,
  ...OkfDiagnostic[],
];

export type NonEmptyRecordIds = readonly [string, ...string[]];

export type StalenessProjection =
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

type ClassifiedStalenessProjection = Exclude<
  StalenessProjection,
  { readonly classified: false }
>;

type RecordStaleness =
  | {
      readonly stalenessClassified: false;
      readonly staleAfter?: never;
      readonly staleAfterEpoch?: never;
    }
  | {
      readonly stalenessClassified: true;
      readonly staleAfter?: never;
      readonly staleAfterEpoch?: never;
    }
  | {
      readonly stalenessClassified: true;
      readonly staleAfter: IsoDateTime;
      readonly staleAfterEpoch: number;
    };

type ClassifiedRecordStaleness = Exclude<
  RecordStaleness,
  { readonly stalenessClassified: false }
>;

interface OkfIndexRecordBase {
  readonly id: string;
  readonly documentId: string;
  readonly path: string;

  readonly title: string;
  readonly description: string;
  readonly type: string;
  readonly tags: string[];
  readonly resource: string;
  readonly sourceText: string;

  readonly headingPath: string;
  readonly text: string;
  readonly startLine: number;
  readonly endLine: number;
}

type StrictIndexRecord = OkfIndexRecordBase & {
  readonly conformance: "strict";
  readonly status: OkfStatus;
  readonly trustTier: OkfTrustTier;
} & ClassifiedRecordStaleness;

type DegradedIndexRecord = OkfIndexRecordBase & {
  readonly conformance: "degraded";
  readonly status?: OkfStatus;
  readonly trustTier?: OkfTrustTier;
} & RecordStaleness;

export type OkfIndexRecord = StrictIndexRecord | DegradedIndexRecord;

type NonEmptyStrictRecords = readonly [
  StrictIndexRecord,
  ...StrictIndexRecord[],
];

type NonEmptyDegradedRecords = readonly [
  DegradedIndexRecord,
  ...DegradedIndexRecord[],
];

export type ProjectedFacets =
  | {
      readonly conformance: "strict";
      readonly status: OkfStatus;
      readonly trustTier: OkfTrustTier;
      readonly staleness: ClassifiedStalenessProjection;
    }
  | {
      readonly conformance: "degraded";
      readonly status?: OkfStatus;
      readonly trustTier?: OkfTrustTier;
      readonly staleness: StalenessProjection;
    };

interface ProjectionIdentity {
  readonly documentId: string;
  readonly path: string;
  readonly type: string;
}

export type OkfIndexProjection =
  | (ProjectionIdentity & {
      readonly conformance: "strict";
      readonly records: NonEmptyStrictRecords;
    })
  | (ProjectionIdentity & {
      readonly conformance: "degraded";
      readonly records: NonEmptyDegradedRecords;
    });

export type OkfPreparedDocument =
  | {
      readonly conformance: "strict";
      readonly diagnostics: readonly [];
      readonly document: OkfDocument;
      readonly projection: Extract<
        OkfIndexProjection,
        { readonly conformance: "strict" }
      >;
    }
  | {
      readonly conformance: "degraded";
      readonly diagnostics: NonEmptyDiagnostics;
      readonly projection: Extract<
        OkfIndexProjection,
        { readonly conformance: "degraded" }
      >;
    };
