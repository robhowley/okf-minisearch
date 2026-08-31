import {
  NativeOkfSearch,
  type PreparedDocument,
  type RemoveIdentity,
  type SearchHit,
  type SearchOptions,
} from "../index.js";

declare const prepared: PreparedDocument[];

const options: SearchOptions = {
  match: "all",
  fields: ["title", "heading", "body"],
  where: {
    types: ["Decision"],
    tagsAny: ["memory"],
    statuses: ["stable"],
    trustTiers: ["human-reviewed"],
    conformance: ["strict"],
    stale: false,
  },
  asOf: new Date(1_000),
  fuzzy: 0.2,
};

const native = NativeOkfSearch.fromPrepared(prepared);
const hits: SearchHit[] = native.search("memory", options);
const identity: RemoveIdentity = {
  documentId: "document-id",
  path: "document.md",
};

native.ingestPrepared(prepared[0]);
native.removeDocument(identity);
native.listTypes();
native.listDegradedDocuments();
void hits;
