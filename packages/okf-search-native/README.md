# `okf-search-native`

A Node-native Open Knowledge Format search package backed by Rust, Tantivy, and
`napi-rs`.

The package root accepts raw Markdown documents and exports exactly
`OkfError`, `createOkfSearch`, `openOkf`, and `validateOkfDocument`. The
`okf-search-native/prepared` subpath exposes the direct prepared-document
binding.

## Supported runtime matrix

The release checks cover Node `>=22.19.0` and Node-API 8 on:

| Platform | Native artifact |
| --- | --- |
| macOS x64 | `okf-search-native.darwin-x64.node` |
| macOS arm64 | `okf-search-native.darwin-arm64.node` |
| Windows x64 (MSVC) | `okf-search-native.win32-x64-msvc.node` |
| Linux x64 (glibc >= 2.17) | `okf-search-native.linux-x64-gnu.node` |

Linux musl/Alpine, Linux arm64, Windows arm64, Bun, Deno, browsers, and other
Node versions are not covered by this matrix.

## Raw Markdown API

```js
import {
  createOkfSearch,
  openOkf,
  validateOkfDocument,
} from "okf-search-native";

const document = {
  path: "notes/memory.md",
  markdown: "---\ntype: note\n---\nMemory safety matters.\n",
};

const validation = validateOkfDocument(document);
const index = createOkfSearch([document]);
const hits = index.search("memory", { limit: 10, fields: ["body"] });

const directoryIndex = await openOkf("./knowledge");
directoryIndex.ingest({
  path: "notes/new.md",
  markdown: "---\ntype: note\n---\nNew material.\n",
});
directoryIndex.remove("notes/new.md");
```

`autoSuggest` is deliberately unsupported and throws an `OkfError` with code
`ERR_OKF_UNSUPPORTED`. The package does not promise MiniSearch ranking, score,
snippet, fuzzy-candidate, or browser parity.

## Prepared API

Callers that already own prepared OKF DTOs can use the direct native boundary:

```js
import { NativeOkfSearch } from "okf-search-native/prepared";

const index = NativeOkfSearch.fromPrepared(preparedDocuments);
const hits = index.search("memory", { limit: 10, fields: ["body"] });
index.ingestPrepared(preparedDocument);
index.removeDocument({ documentId: "docs/old", path: "docs/old.md" });
```

Prepared DTO declarations are exported from `okf-search-native/prepared`, not
from the package root.

## Generated and built files

`napi build` generates `native.cjs`, `native.d.cts`, and the host `.node`
artifact. The friendly facade build writes `dist/index.cjs`, `dist/index.mjs`,
`dist/index.d.cts`, `dist/index.d.mts`, and `dist/index.d.ts`. Generated native
loader names are internal and are not package-root exports.

## Development

Use Rust `1.88.0`:

```sh
pnpm install
pnpm --filter okf-search-native run build
pnpm --filter okf-search-native run check:rust
pnpm --filter okf-search-native run test
```

For multi-target candidate assembly, copy the four tested `.node` files into
the package root, then run `pnpm run verify:release-artifacts`. The verifier
derives the required artifact names from the checked-in target list and
rejects missing or extra native files.
