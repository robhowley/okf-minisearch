# @robhowley/pi-okf-search

Search a local [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/open-knowledge-format) Markdown directory from [Pi](https://pi.dev/). The package adds one read-only tool, `okf_search`, which returns ranked snippets with source paths and line ranges. Use `/okf status` to inspect the loaded index and `/okf refresh` to rebuild it.

## Quick start

Install the package:

```sh
pi install npm:@robhowley/pi-okf-search
```

Add `pi-okf-search` to `~/.pi/agent/settings.json`:

```json
{
  "pi-okf-search": {
    "root": "/absolute/path/to/knowledge"
  }
}
```

Start Pi and ask it to search:

```text
Search the knowledge base to find the rollback procedure.
```

## Inspect the loaded index

Run `/okf status` to confirm which directory Pi loaded, which document types it found, and how recently it built the in-memory index.

![The OKF status command showing the loaded root, document types, and index freshness](docs/okf-status.png)

If the configured root or source files change, run `/okf refresh`. A successful refresh re-reads the effective configuration, rebuilds the snapshot, and resets the displayed `Indexed` age. Restarting Pi or running `/reload` also creates a fresh extension runtime.

## Configuration

`root` is the only supported setting. It must be a nonblank string.

| Scope | Settings file | Relative roots start from |
| --- | --- | --- |
| Global | `~/.pi/agent/settings.json` | `~/.pi/agent` |
| Project | `.pi/settings.json` | `.pi` |

Project level setting replaces the global setting. Use an absolute path when you do not want resolution to depend on the settings location.

## Search and results

By default, `okf_search` searches every indexed field, matches any query term, tolerates minor typos, and returns up to five results. The model can narrow a search by field or filter by document type, tag, status, trust tier, or staleness. It can require every query term with `match: "all"`, disable typo tolerance with `fuzzy: false`, or request up to 10 results. Once the final query term reaches three characters, it also matches prefixes—even when typo tolerance is enabled.

A result looks like this:

```text
1 hit

1. Database rollback
   Heading: Restore snapshot
   /Users/alice/project/knowledge/runbooks/database-rollback.md:9-11
   Matched: title, body
   Restore the last known-good snapshot, then verify application health.
```

The path is absolute and the line range is inclusive.

`No matches.` means the index returned no evidence for that query; it does not prove the information is absent.

## Indexing and reloads

The extension recursively indexes `.md` files under `root`, except files named exactly `index.md` or `log.md`. The index is held in memory, does not modify source files, and is not updated automatically.

Run `/okf refresh` after changing the configuration or indexed files. It re-reads the effective configuration and fully rebuilds the in-memory snapshot without reloading unrelated extensions. On success, the `Indexed` age shown by `/okf status` resets. Restarting Pi or running `/reload` also creates a fresh extension runtime.

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
