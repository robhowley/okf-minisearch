import type {
  OkfStatus,
  OkfTrustTier,
} from "./vocabulary.js";

export type {
  OkfStatus,
  OkfTrustTier,
} from "./vocabulary.js";

export type IsoDateTime = string;

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

  status?: OkfStatus;
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
  /**
   * Relative POSIX identity. Empty and `.` segments normalize away;
   * case and `\` remain significant.
   */
  path: string;
  markdown: string;
}

export type OkfDiagnosticCode =
  | "ERR_OKF_PARSE"
  | "ERR_OKF_FIELD";

export interface OkfDiagnostic {
  code: OkfDiagnosticCode;
  path: string;
  field?: string;
  message: string;
}

export interface OkfValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly OkfDiagnostic[];
}

export interface OkfIndexRecord {
  id: string;
  documentId: string;
  path: string;

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

  status?: OkfStatus;
  staleAfter?: IsoDateTime;
  staleAfterEpoch?: number;
  stalenessClassified: boolean;
  trustTier?: OkfTrustTier;
}

export interface OkfIngestResult {
  document: OkfDocument;
  records: readonly OkfIndexRecord[];
  diagnostics: readonly OkfDiagnostic[];
}

export type OkfSearchField =
  | "resource"
  | "title"
  | "heading"
  | "description"
  | "tags"
  | "type"
  | "sources"
  | "body";

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

  match?: "any" | "all";
  fields?: readonly OkfSearchField[];
  fuzzy?: boolean;
}

export interface OkfSearchHit {
  documentId: string;
  sectionId: string;
  score: number;
  matchedFields: OkfSearchField[];

  headingPath: string;
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

export interface OkfSearch {
  ingest(input: OkfDocumentInput): OkfIngestResult;

  remove(path: string): boolean;

  search(
    query: string,
    options?: OkfSearchOptions,
  ): OkfSearchHit[];
}