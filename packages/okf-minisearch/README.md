# okf-minisearch

Search an [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/open-knowledge-format) directory from Node.js without running a separate search service. `okf-minisearch` loads OKF Markdown into an in-memory [MiniSearch](https://lucaong.github.io/minisearch/) index and returns the most relevant section from each matching document.

## Install

```sh
npm install okf-minisearch
```

Requires Node.js 20 or newer. The package is ESM-only and includes TypeScript declarations.

## Quick start

Create an OKF concept such as `knowledge/database-rollback.md`:

```md
---
type: runbook
title: Database rollback
tags: [database, operations]
status: stable
verified:
  - by: human:alice
    at: 2026-08-24T10:00:00Z
---
# Before you start

Confirm that a recent backup is available.

# Roll back

Restore the last known-good snapshot, then verify application health.
```

Open the directory and search it:

```js
import { openOkf } from "okf-minisearch";

const okf = await openOkf("./knowledge");
const hits = okf.search("rollback snapshot");

for (const hit of hits) {
  console.log(hit.path, hit.headingPath, hit.snippet);
}
```

`openOkf(root)` recursively reads regular `.md` files. Files named exactly `index.md` or `log.md` are reserved and are not indexed.

## Search

```js
const hits = okf.search("rollback snapshot", {
  match: "all",
  fields: ["title", "body"],
  limit: 5,
  where: {
    types: ["runbook"],
    tagsAny: ["database", "storage"],
    statuses: ["stable"],
    trustTiers: ["human-reviewed"],
    stale: false,
  },
  asOf: new Date("2026-08-24T12:00:00Z"),
});
```

Filters are combined with AND. Values within `types`, `tagsAny`, `statuses`, and `trustTiers` are combined with OR. Empty filter arrays are ignored.

| Option | Behavior |
| --- | --- |
| `limit` | Maximum returned documents. Defaults to `10`; `0` returns no hits. |
| `match` | `"any"` (the default) matches any query term; `"all"` requires every term in one indexed section or chunk. Terms may match different fields in that section. |
| `fields` | Non-empty readonly list of fields to search. Omission searches all fields. See the alias table below. |
| `fuzzy` | Opt-in spelling-near matching. Omission and `false` keep fuzzy matching off; `true` enables the wrapper's fixed conservative policy. |
| `where.types` | Matches the frontmatter `type`. Directory names do not define type. |
| `where.tagsAny` | Matches documents containing at least one listed tag. |
| `where.statuses` | Matches `draft`, `stable`, or `deprecated`. |
| `where.trustTiers` | Matches `unverified`, `machine-confirmed`, or `human-reviewed`. |
| `where.stale` | Matches whether `stale_after` is at or before `asOf`. |
| `asOf` | Time used for stale filtering. Defaults to the current time. |

Search covers these public fields:

| Public field | Indexed content |
| --- | --- |
| `resource` | Document resource |
| `title` | Document title |
| `heading` | Section heading path |
| `description` | Document description |
| `tags` | Document tags |
| `type` | Document type |
| `sources` | Source IDs, titles, authors, and resources |
| `body` | Section or chunk body text |

`fields` scopes text matching only; `where` metadata filters remain independent. The final query term receives prefix matching when it has at least three characters; this remains active with `fuzzy: true`, so an earlier term can use fuzzy matching while the final term uses prefix matching.

When enabled, `fuzzy: true` maps to a fixed MiniSearch fuzziness ratio of `0.2`. This ratio is deliberately pinned and is not a configurable public option. Fuzzy expansion can produce spelling-near false positives, including unrelated results whose words are close in spelling, so use it only when typo recovery is worth that precision tradeoff.

`match: "all"` is section-level: every processed term must match the same indexed section or chunk. It never combines terms from separate sections of one document. One hit is returned per document. Hits are ordered by descending score, with deterministic section-ID ordering for exact score ties.

Each hit contains:

```ts
interface OkfSearchHit {
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
```

`documentId` is the normalized relative Markdown path without `.md`. `sectionId` identifies the current indexed section or chunk and may change when headings or chunk boundaries change. `score` is an index-local relevance value; compare it only among hits from the same search. `matchedFields` uses the public field aliases above and contains unique values in first-match order.

Previous releases exposed MiniSearch field names in `matchedFields`. Migrate `headingPath` to `heading`, `sourceText` to `sources`, and `text` to `body`. The separate `headingPath` hit property is unchanged.

## Validate a document

Use `validateOkfDocument` to check in-memory Markdown without opening a directory or changing an index:

```js
import { validateOkfDocument } from "okf-minisearch";

const result = validateOkfDocument({
  path: "guides/recovery.md",
  markdown,
});

if (!result.isValid) {
  console.error(result.errors);
}
```

Expected path, frontmatter, YAML, Markdown, and known-field failures return a result with diagnostics instead of throwing. Each diagnostic has `code`, normalized or redacted `path`, optional `field`, and `message`.

`validateOkfDocument` validates one in-memory concept document against the OKF v0.2 specification. It does not validate the surrounding bundle, resolve referenced content, execute computations, or verify attestation claims.

## Add or replace a document

Use `ingest` when a caller already has Markdown or needs to update the in-memory index:

```js
const result = okf.ingest({
  path: "guides/recovery.md",
  markdown: `---
type: guide
title: Recovery guide
tags: [operations]
---
# Recovery

Restart the worker and inspect its health check.
`,
});

console.log(result.document.id); // guides/recovery
console.log(result.records.length);
console.log(result.diagnostics);
```

`path` must be a bundle-relative POSIX `.md` path. `.` and repeated internal `/` segments are normalized. Absolute paths, parent traversal (`..`), Windows drive or UNC paths, paths ending in `/` or `/.`, and files named exactly `index.md` or `log.md` are rejected.

Ingesting the normalized path again replaces that concept’s indexed records. Replacement is atomic: malformed input leaves the existing records searchable.

`ingest` does not write the file, watch the filesystem, or persist the index. Call it whenever your application accepts an updated document.

## Remove a document

Use `remove` to drop one document from the current in-memory index:

```js
const removed = okf.remove("./guides//recovery.md");
console.log(removed); // true
console.log(okf.search("worker health")); // []

console.log(okf.remove("guides/recovery.md")); // false: valid absence/repeat
console.log(okf.remove("missing.md")); // false: valid absence
```

`remove(path)` uses the same path rules as `ingest`. It removes every indexed section and chunk for that document.

- Returns `true` when the document was indexed.
- Returns `false` when the path is valid but not indexed.
- Throws `OkfError` before changing the index when the path is invalid or reserved.

Path normalization removes empty and `.` segments while preserving case and literal backslashes. Unsafe paths report `"<input>"`; invalid extensions and reserved filenames report the normalized path.

Removal affects only the current in-memory index. It does not modify the source file. Reopening the root indexes the file again.

## Accepted OKF documents

`okf-minisearch` provides in-memory search over [OKF v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md) bundles.

The package applies these defaults:

- A missing title is derived from the filename.
- A missing `status` means `stable`.
- A missing `verified` field means `unverified`.
- Any valid `human:<id>` verification means `human-reviewed`.
- Other valid verification actors mean `machine-confirmed`.
- A missing `stale_after` means the concept is not stale.
- Unknown frontmatter fields are retained in `document.extensions`.

Official fields are validated against their OKF v0.2 definitions. Unknown concept types and extension keys remain accepted. Validation does not inspect the surrounding bundle or resolve links or resource paths.

## Errors

`openOkf`, `ingest`, and `remove` throw `OkfError` for invalid documents or paths. `openOkf` also uses it for filesystem errors. `validateOkfDocument` returns document errors as diagnostics instead of throwing.

```js
import { OkfError, openOkf } from "okf-minisearch";

try {
  await openOkf("./knowledge");
} catch (error) {
  if (error instanceof OkfError) {
    console.error(error.code, error.path, error.field);
  } else {
    throw error;
  }
}
```

| Code | Meaning |
| --- | --- |
| `ERR_OKF_READ` | A selected directory or concept could not be read. |
| `ERR_OKF_PARSE` | Frontmatter, YAML, UTF-8, or Markdown could not be parsed. |
| `ERR_OKF_FIELD` | A caller-supplied path or known field is invalid. |

`search` throws `TypeError("options.asOf must be a valid Date")` for an invalid `asOf`, `TypeError("options.limit must be a finite non-negative integer")` for an invalid limit, and `TypeError("options.fuzzy must be a boolean")` for a non-boolean `fuzzy` value.

## Public API

The package root exports `openOkf`, `validateOkfDocument`, and `OkfError`. `openOkf(root)` returns an `OkfSearch` handle with `search(query, options?)`, `ingest(input)`, and `remove(path)`. Public TypeScript types can be imported from the package root:

```ts
import type {
  OkfDiagnostic,
  OkfDiagnosticCode,
  OkfDocumentInput,
  OkfValidationResult,
  OkfIngestResult,
  OkfSearch,
  OkfSearchField,
  OkfSearchHit,
  OkfSearchOptions,
} from "okf-minisearch";
```

See the generated declarations for the complete type surface.

## License

MIT
