# okf-minisearch
OKF-optimized search for LLM wikis, Obsidian vaults, and documentation repositories, built on MiniSearch.

[![Package validation](https://github.com/robhowley/okf-minisearch/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/robhowley/okf-minisearch/actions/workflows/ci.yml)

## Quick start

```sh
npm install okf-minisearch
```

Given an OKF Markdown tree in `./knowledge`:

```js
import { openOkf } from "okf-minisearch";

const okf = await openOkf("./knowledge");
const [hit] = okf.search("rollback snapshot", { limit: 1 });

console.log({
  path: hit.path,
  headingPath: hit.headingPath,
  startLine: hit.startLine,
  endLine: hit.endLine,
  snippet: hit.snippet,
});
```

```text
{
  path: 'runbooks/database-rollback.md',
  headingPath: 'Database rollback > Restore snapshot',
  startLine: 9,
  endLine: 11,
  snippet: 'Restore the last known-good snapshot, then verify application health.'
}
```

## What it gives you

- Loads a local Markdown tree recursively into an in-memory MiniSearch index; no separate service.
- Returns one ranked section per document with its path, heading path, line range, and snippet.
- Filters by type, tags, status, trust tier, and staleness.
- Uses `ingest` for atomic add/replace updates and `remove` for explicit in-memory removal; malformed replacements leave existing records searchable, and source files stay unchanged.

OKF Markdown → openOkf() → in-memory MiniSearch index → relevant section

## Requirements and docs

Node.js 20+, ESM-only, and TypeScript declarations.

- [Package documentation](packages/okf-minisearch/README.md)
- [Pinned OKF v0.2 specification](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md)
- [MiniSearch documentation](https://lucaong.github.io/minisearch/)

## License

Released under the [MIT License](LICENSE).
