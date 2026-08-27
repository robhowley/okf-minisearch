# @robhowley/pi-okf-search

Search a local [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/open-knowledge-format) Markdown directory from Pi. The package adds one read-only tool, `okf_search`, which returns ranked snippets with source paths and line ranges.

## Quick start

Requires [Pi](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/quickstart.md) and Node.js `>=22.19.0`.

Install the package globally:

```sh
pi install npm:@robhowley/pi-okf-search
```

Add `pi-okf-search` to `~/.pi/agent/settings.json`, keeping the `packages` entry created by `pi install`:

```json
{
  "pi-okf-search": {
    "root": "/absolute/path/to/knowledge"
  }
}
```

Start Pi and ask it to search:

```text
Use okf_search to find the rollback procedure.
```

## Project-local setup

To install and configure the package for one project:

```sh
pi install npm:@robhowley/pi-okf-search -l
```

Add the configuration to `.pi/settings.json`. A repository-level `knowledge` directory is one level above that settings file:

```json
{
  "pi-okf-search": {
    "root": "../knowledge"
  }
}
```

Trust the project when Pi prompts. Project settings apply only to trusted projects.

## Configuration

`root` is the only supported setting. It must be a nonblank string.

| Scope | Settings file | Relative roots start from |
| --- | --- | --- |
| Global | `~/.pi/agent/settings.json` | `~/.pi/agent` |
| Project | `.pi/settings.json` | `.pi` |

A trusted project `pi-okf-search` section replaces the global section. If the project has no section, Pi uses the global one. Use an absolute path when you do not want resolution to depend on the settings location.

## Search and results

The model can search all content or narrow a query by field, document type, tag, status, trust tier, or staleness. It can also require all terms, enable fuzzy matching, and request up to 10 results. When omitted, the Pi tool defaults to 5 results, OR term matching (`match: "any"`), and typo-tolerant matching (`fuzzy: true`, equivalent to a 0.2 fuzzy threshold). Set `match: "all"` or `fuzzy: false` to override these defaults. The final query term receives prefix matching when it has at least three characters, including with the default fuzzy setting.

A result looks like this:

```text
1 hit

1. Database rollback
   Heading: Restore snapshot
   /Users/alice/project/knowledge/runbooks/database-rollback.md:9-11
   Matched: title, body
   Restore the last known-good snapshot, then verify application health.
```

The path is absolute and the line range is inclusive. To reopen the result with Pi's `read` tool, use the returned path, `offset = 9`, and `limit = 3` for the example above.

`No matches.` means the index returned no evidence for that query; it does not prove the information is absent.

## Indexing and reloads

The extension recursively indexes `.md` files under `root`, except files named exactly `index.md` or `log.md`. The index is held in memory, does not modify source files, and is not updated automatically.

Run `/reload` or restart Pi after changing the configuration or indexed files.

## Development

From the repository root:

```sh
pnpm install
pnpm --filter okf-minisearch build
pi -e ./packages/pi-okf-search/extensions/okf-search/index.ts
pnpm package:check
```

The library must be built before running the extension from this checkout. `pnpm package:check` runs the repository's build, typecheck, tests, packing, and packed-consumer checks.

## License

MIT. See the repository [LICENSE](https://github.com/robhowley/okf-minisearch/blob/main/LICENSE).
