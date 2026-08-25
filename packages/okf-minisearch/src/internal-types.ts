import type {
  IsoDateTime,
  OkfDocument,
  OkfStatus,
  OkfTrustTier,
} from "./types.js";

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

  status: OkfStatus;
  staleAfter?: IsoDateTime;
  staleAfterEpoch?: number;
  stalenessClassified: boolean;
  trustTier: OkfTrustTier;
}

export interface OkfPreparedDocument {
  document: OkfDocument;
  records: readonly OkfIndexRecord[];
}
