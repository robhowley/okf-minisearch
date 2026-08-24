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
const hits = okf.search("rollback", {
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
| `where.types` | Matches the frontmatter `type`. Directory names do not define type. |
| `where.tagsAny` | Matches documents containing at least one listed tag. |
| `where.statuses` | Matches `draft`, `stable`, or `deprecated`. |
| `where.trustTiers` | Matches `unverified`, `machine-confirmed`, or `human-reviewed`. |
| `where.stale` | Matches whether `stale_after` is at or before `asOf`. |
| `asOf` | Time used for stale filtering. Defaults to the current time. |

Search covers resource, title, heading path, description, tags, type, source IDs, source titles, source authors, source resources, and body text. The final query term receives prefix matching when it has at least three characters.

One hit is returned per document. Hits are ordered by descending score, with deterministic section-ID ordering for exact score ties.

Each hit contains:

```ts
interface OkfSearchHit {
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
```

`documentId` is the normalized relative Markdown path without `.md`. `sectionId` identifies the current indexed section or chunk and may change when headings or chunk boundaries change. `score` is an index-local relevance value; compare it only among hits from the same search.

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

Malformed optional status, verification, or staleness metadata does not prevent searching the concept. It simply does not match filters for that metadata.

## Errors

Filesystem, parsing, and required-field failures throw `OkfError`:

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
| `ERR_OKF_FIELD` | A required field or caller-supplied path is invalid. |

`search` throws `TypeError("options.asOf must be a valid Date")` for an invalid `asOf`, and `TypeError("options.limit must be a finite non-negative integer")` for an invalid limit.

## Public API

The runtime API contains `openOkf` and `OkfError`. Public TypeScript types can be imported from the package root:

```ts
import type {
  OkfDocumentInput,
  OkfIngestResult,
  OkfSearch,
  OkfSearchHit,
  OkfSearchOptions,
} from "okf-minisearch";
```

See the generated declarations for the complete type surface.

## License

MIT
