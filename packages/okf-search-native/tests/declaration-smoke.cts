import {
  OkfError,
  createOkfSearch,
  openOkf,
  validateOkfDocument,
  type OkfSearch,
  type OkfSearchOptions,
  type OkfValidationResult,
} from "okf-search-native";
import {
  NativeOkfSearch,
  type PreparedDocument,
} from "okf-search-native/prepared";

type Same<T, U> =
  (<V>() => V extends T ? 1 : 2) extends
  (<V>() => V extends U ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type ExactPreparedRemove = Assert<Same<
  NativeOkfSearch["removeDocument"],
  (documentId: string) => boolean
>>;
type ExactAutoSuggest = Assert<Same<
  OkfSearch["autoSuggest"],
  (query: string, options?: OkfSearchOptions) => never
>>;

const error = new OkfError("ERR_OKF_UNSUPPORTED", "autoSuggest");
const rootHandle: OkfSearch = createOkfSearch([]);
const opened: Promise<OkfSearch> = openOkf(".");
const validation: OkfValidationResult = validateOkfDocument({
  path: "types.md",
  markdown: "---\ntype: note\n---\n",
});
declare const prepared: PreparedDocument[];
const native = NativeOkfSearch.fromPrepared(prepared);
native.removeDocument("prepared");
// @ts-expect-error Prepared removal accepts only a document ID.
native.removeDocument({ documentId: "prepared", path: "prepared.md" });

void [
  error,
  rootHandle,
  opened,
  validation,
  native,
  null as ExactAutoSuggest | null,
  null as ExactPreparedRemove | null,
];
