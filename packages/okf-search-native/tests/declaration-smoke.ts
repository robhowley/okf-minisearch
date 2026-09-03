import * as nativeApi from "../index.js";
import {
  NativeOkfSearch,
  type DegradedDocument,
  type PreparedDocument,
  type RemoveIdentity,
  type SearchHit,
  type SearchOptions,
  type Suggestion,
} from "../index.js";

type Same<T, U> =
  (<V>() => V extends T ? 1 : 2) extends
  (<V>() => V extends U ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type ExactRuntimeExports = Assert<Same<keyof typeof nativeApi, "NativeOkfSearch">>;
type ExactInstanceMethods = Assert<Same<
  keyof NativeOkfSearch,
  | "ingestPrepared"
  | "removeDocument"
  | "search"
  | "listTypes"
  | "listDegradedDocuments"
  | "autoSuggest"
>>;
type ExactFromPrepared = Assert<Same<
  typeof NativeOkfSearch.fromPrepared,
  (documents: PreparedDocument[]) => NativeOkfSearch
>>;
type ExactIngestPrepared = Assert<Same<
  NativeOkfSearch["ingestPrepared"],
  (document: PreparedDocument) => void
>>;
type ExactRemoveDocument = Assert<Same<
  NativeOkfSearch["removeDocument"],
  (identity: RemoveIdentity) => boolean
>>;
type ExactSearch = Assert<Same<
  NativeOkfSearch["search"],
  (query: string, options?: SearchOptions | null) => SearchHit[]
>>;
type ExactListTypes = Assert<Same<
  NativeOkfSearch["listTypes"],
  () => string[]
>>;
type ExactListDegradedDocuments = Assert<Same<
  NativeOkfSearch["listDegradedDocuments"],
  () => DegradedDocument[]
>>;
type ExactAutoSuggest = Assert<Same<
  NativeOkfSearch["autoSuggest"],
  (query: string, options?: SearchOptions | null) => Suggestion[]
>>;

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
void [
  hits,
  null as ExactRuntimeExports | null,
  null as ExactInstanceMethods | null,
  null as ExactFromPrepared | null,
  null as ExactIngestPrepared | null,
  null as ExactRemoveDocument | null,
  null as ExactSearch | null,
  null as ExactListTypes | null,
  null as ExactListDegradedDocuments | null,
  null as ExactAutoSuggest | null,
];
