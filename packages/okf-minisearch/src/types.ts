export type IsoDateTime = string;
export type OkfStatus = "draft" | "stable" | "deprecated";
export type OkfTrustTier =
  | "unverified"
  | "machine-confirmed"
  | "human-reviewed";

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

export interface OkfReservedFile {
  path: string;
  body: string;
}

export interface OkfBundle {
  root: string;
  okfVersion?: string;
  documents: ReadonlyMap<string, OkfDocument>;
  indexes: ReadonlyMap<string, OkfReservedFile>;
  logs: ReadonlyMap<string, OkfReservedFile>;
}

export interface OkfDocumentInput {
  path: string;
  markdown: string;
}

export interface OkfDiagnostic {
  severity: "warning" | "error";
  message: string;
}

export interface OkfIndexRecord {
  id: string;
  documentId: string;

  title: string;
  description: string;
  type: string;
  tags: string[];
  resource: string;
  sourceText: string;

  headingPath: string;
  text: string;
  startLine: number;
  endLine: number;

  status: OkfStatus;
  staleAfter?: IsoDateTime;
  trustTier: OkfTrustTier;
}

export interface OkfIngestResult {
  document: OkfDocument;
  records: readonly OkfIndexRecord[];
  diagnostics: readonly OkfDiagnostic[];
}

export interface OkfSearchOptions {
  limit?: number;

  where?: {
    types?: readonly string[];
    tagsAny?: readonly string[];
    statuses?: readonly OkfStatus[];
    trustTiers?: readonly OkfTrustTier[];
    stale?: boolean;
  };

  asOf?: Date;
}

export interface OkfSearchHit {
  documentId: string;
  sectionId: string;
  score: number;
  matchedFields: string[];

  headingPath: string;
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export interface OkfSearch {
  ingest(input: OkfDocumentInput): OkfIngestResult;

  search(
    query: string,
    options?: OkfSearchOptions,
  ): OkfSearchHit[];
}