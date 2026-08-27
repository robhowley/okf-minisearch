# okf-minisearch
okf-minisearch is the Node.js library for OKF-optimized search. `@robhowley/pi-okf-search` exposes that library as a Pi tool for one configured local OKF Markdown tree.

[![Package validation](https://github.com/robhowley/okf-minisearch/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/robhowley/okf-minisearch/actions/workflows/ci.yml)

## Packages

- [`okf-minisearch`](packages/okf-minisearch/README.md) — the ESM Node.js library and TypeScript API.
- [`@robhowley/pi-okf-search`](packages/pi-okf-search/README.md) — a Pi resource package with the read-only `okf_search` tool.

Install the Pi package with:

```sh
pi install npm:@robhowley/pi-okf-search
```

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
  title: hit.title,
  path: hit.path,
  headingPath: hit.headingPath,
  startLine: hit.startLine,
  endLine: hit.endLine,
  snippet: hit.snippet,
});
```

```text
{
  title: 'Database rollback',
  path: 'runbooks/database-rollback.md',
  headingPath: 'Database rollback > Restore snapshot',
  startLine: 9,
  endLine: 11,
  snippet: 'Restore the last known-good snapshot, then verify application health.'
}
```

## What it gives you

- Loads a local OKF Markdown tree recursively into an in-memory MiniSearch index; no separate service.
- Returns one ranked section per document with its title, path, heading path, line range, and snippet.
- Filters by type, tags, status, trust tier, and staleness.
- Uses `ingest` for add/replace updates and `remove` for explicit in-memory removal; malformed replacements leave existing records searchable, and source files stay unchanged.

OKF Markdown → openOkf() → in-memory MiniSearch index → relevant section

## Requirements and docs

- **Library:** Node.js 20+, ESM-only, and TypeScript declarations.
- **Pi package:** Node.js `>=22.19.0`, tested with Pi packages `0.84.3`; Pi loads the TypeScript extension source through jiti rather than as a direct Node entry point.

- [Package documentation](packages/okf-minisearch/README.md)
- [Pi package documentation](packages/pi-okf-search/README.md)
- [Pinned OKF v0.2 specification](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md)
- [MiniSearch documentation](https://lucaong.github.io/minisearch/)

## Development

Build the library locally:

```sh
pnpm --filter okf-minisearch build
```

Run the Pi extension from its TypeScript source:

```sh
pi -e ./packages/pi-okf-search/extensions/okf-search/index.ts
```

The library must be built locally before using the extension. The Pi package has no build step; run its source through Pi rather than directly with Node.

## License

Released under the [MIT License](LICENSE).
