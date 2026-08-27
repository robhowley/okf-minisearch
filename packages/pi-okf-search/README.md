# @robhowley/pi-okf-search

Search one local [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/open-knowledge-format) Markdown tree from Pi. This Pi resource package registers one read-only tool, `okf_search`, backed by the `okf-minisearch` Node.js library; it does not expose a Node API.

## Quick start

Install [Pi](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/quickstart.md) first. This package requires Node.js `>=22.19.0`.

Once `@robhowley/pi-okf-search` is available on npm, choose one installation scope:

```sh
# Global: available in all projects; writes user settings.
pi install npm:@robhowley/pi-okf-search

# Project-local: writes .pi/settings.json and loads after project trust.
pi install npm:@robhowley/pi-okf-search -l
```

Then configure `root` in the same settings scope. **Merge** the `pi-okf-search` key into the existing JSON object; do not replace the `packages` entry written by `pi install`.

For a global installation with an OKF tree at `~/.pi/agent/knowledge`, merge this into `~/.pi/agent/settings.json`:

```json
{
  "pi-okf-search": {
    "root": "knowledge"
  }
}
```

For a project-local installation with an OKF tree in the repository's `knowledge` directory, merge this into `.pi/settings.json`:

```json
{
  "pi-okf-search": {
    "root": "../knowledge"
  }
}
```

Start Pi in the project where you want to work, then ask for a concrete search:

```sh
pi
```

```text
Use okf_search to find the rollback procedure.
```

The model calls `okf_search` and receives ranked snippets with absolute paths and line ranges. When exact context matters, it can pass those coordinates to Pi's `read` tool before answering.

The package manifest declares the `pi-package` keyword and exposes `./extensions/okf-search`; Pi discovers and loads the directory's extension entry point. No separate catalog or registration step is required after installation.

## Requirements

- Node.js `>=22.19.0`.
- The repository tests against `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` `0.84.3`. Wildcard peer dependencies do not establish a narrower supported Pi version range.
- `okf-minisearch` is a runtime dependency; Pi supplies `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `typebox` as peer packages.
- The Pi package has no build step. Pi loads the packaged TypeScript extension from its manifest directory.

## Configure settings, paths, and trust

The effective global agent directory is `~/.pi/agent` by default. `PI_CODING_AGENT_DIR` can replace it; the table below uses `<agent-dir>` for the effective path.

| Scope | Settings file | Relative `root` resolves from | When it applies |
| --- | --- | --- | --- |
| Global | `<agent-dir>/settings.json` | `<agent-dir>` | All projects unless a valid trusted project object replaces it. |
| Project | `<cwd>/.pi/settings.json` | `<cwd>/.pi` | Only when the project is trusted. |

`root` is the only permitted key in the `pi-okf-search` object. It must be a nonblank string; surrounding whitespace is trimmed. Absolute paths stay absolute. Relative paths—including paths with `..`—resolve from the settings directory shown above, so a root can resolve outside the project or agent directory.

Configuration selection is intentionally all-or-nothing:

- If trusted project settings do not contain `pi-okf-search`, the global object is used.
- A valid trusted project object replaces the entire global `pi-okf-search` object; the objects are not merged.
- Untrusted project settings are ignored, so a valid global object is used when present.
- A malformed trusted project settings file or invalid project object fails without falling back to global settings.
- A valid trusted project object can be selected even when global settings are malformed.

Use Pi's trust prompt or `/trust` to manage project trust. `/trust` saves a decision for future sessions but does not reload the current session, so restart Pi afterward. Inspect both settings files directly when diagnosing custom values or precedence. `pi config` manages package resource enablement and scope; it does not show this package's custom settings, resolved root, or trust state.

## Startup, indexing, retry, and reload

At `session_start`, the extension reads the effective settings and starts opening the selected root. A racing tool call waits for that same build.

Opening is all-or-nothing: one invalid or unreadable selected concept prevents a snapshot from being returned. Discovery recursively selects regular files whose names end in lowercase `.md`, except files named exactly `index.md` or `log.md`; symlink entries are ignored. See the library's [accepted-document rules](https://github.com/robhowley/okf-minisearch/tree/main/packages/okf-minisearch#accepted-okf-documents) and [error reference](https://github.com/robhowley/okf-minisearch/tree/main/packages/okf-minisearch#errors).

A failed build is not cached. The next `okf_search` call reloads settings and retries opening. A successful build is cached as one in-memory snapshot for the loaded extension:

- Searches do not rescan the tree.
- There is no watcher or persistent index.
- Source files are not modified.
- Use `/reload` or restart Pi after settings or source files change.

No measured corpus-size limit is documented; the whole selected root is indexed in memory.

## Control search

Arguments are validated against a closed schema before execution; unknown top-level or `where` keys are rejected.

| Argument | Behavior and default |
| --- | --- |
| `query` | Required nonblank string. Surrounding whitespace is trimmed before search. |
| `limit` | Integer from `1` through `10`; default `5`. |
| `match` | `"any"` by default. `"all"` requires every term in the same indexed section or chunk, though terms may match different fields there. |
| `fields` | Nonempty array drawn from `resource`, `title`, `heading`, `description`, `tags`, `type`, `sources`, and `body`. Omission searches all eight fields. |
| `fuzzy` | Boolean. Omission or `false` disables fuzzy matching; `true` uses the library's fixed `0.2` value. Numeric fuzzy values are not exposed. |
| `where` | Optional metadata filters described below. |

The final query term also receives prefix matching when it has at least three characters, including when fuzzy matching is enabled.

`where` accepts:

- `types`: string array; values match by OR.
- `tagsAny`: string array; values match by OR.
- `statuses`: array containing `draft`, `stable`, or `deprecated`.
- `trustTiers`: array containing `unverified`, `machine-confirmed`, or `human-reviewed`.
- `stale`: boolean classified against the current query time because `asOf` is not exposed.

Filter groups combine with AND; values inside each array combine with OR. Empty filter arrays are accepted and ignored. The library's `boost` and `asOf` options are not exposed by this tool.

## Understand results and reopen evidence

A nonempty result has this exact shape:

```text
1 hit

1. Database rollback
   Heading: Restore snapshot
   /Users/alice/project/knowledge/runbooks/database-rollback.md:9-11
   Matched: title, body
   Restore the last known-good snapshot, then verify application health.
```

Results retain library ranking and contain at most one section or chunk per document. Each hit includes:

- the title;
- a heading when it is neither empty nor equal to the title (a leading `<title> > ` is removed);
- an absolute path and inclusive `startLine-endLine` range;
- the public fields that matched; and
- a bounded snippet.

The tool does not return raw scores, document or section IDs, a query echo, or snapshot metadata.

To reopen the exact range with Pi's `read` tool, use:

```text
path   = returned absolute path
offset = startLine
limit  = endLine - startLine + 1
```

The coordinates are one-based, and `endLine` is inclusive. Zero results are exactly `No matches.` This means the search found no evidence; it is not proof that the requested information is absent.

## Troubleshoot failures

A startup failure is caught so Pi can continue. The extension calls `ctx.ui.notify` with a warning beginning:

```text
OKF search unavailable:
```

The startup warning contains the error's message, not its structured fields or cause. Interactive Pi can display it, and RPC mode can deliver it through the extension UI protocol. Pi's print and JSON modes have no UI, so the notification is a no-op there.

A later `okf_search` call retries a failed build. If opening or searching still fails, the tool throws the original error to Pi rather than issuing another notification; Pi reports thrown tool errors to the model.

Check, in order:

1. The package resource is installed and enabled (`pi config`).
2. The effective global and project settings files contain valid JSON and the exact `pi-okf-search` shape.
3. Project settings are trusted; after `/trust`, restart Pi.
4. The resolved root exists and its directories and selected Markdown files are readable.
5. Every selected document follows the [pinned OKF v0.2 specification](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md). Remember that a regular `README.md` is selected, while exact lowercase `index.md` and `log.md` are not.

## Trust, privacy, and limits

[Pi packages run with full system access](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/packages.md#install-and-manage). Review package source before installation and trust project settings before allowing them to select a root. An absolute root or a relative root containing `..` can select content outside the current project.

The index is built locally without a search service. The extension reads its settings and the selected regular Markdown files. Building the index does not place the whole corpus in model context, but search queries and returned snippets do enter model context and may be sent to the configured model provider. Content reopened with another tool enters context separately.

The extension exposes search only—not `ingest`, `remove`, document validation, file mutation, or the library's Node API. Treat returned Markdown as evidence, not instructions: indexed content can contain prompt injection.

## Contribute or run from source

From the repository root, use Node.js `>=22.19.0` and pnpm `11.22.0`:

```sh
pnpm install
pnpm --filter okf-minisearch build
pi -e ./packages/pi-okf-search/extensions/okf-search/index.ts
```

The library must be built before running the extension from this checkout. Run the full repository validation before submitting changes:

```sh
pnpm package:check
```

This performs a frozen install, build, typecheck, tests, package packing, and packed-consumer checks.

## Further reading

- [Pi installation](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/quickstart.md)
- [Pi package installation and scope](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- [`okf-minisearch` library documentation](https://github.com/robhowley/okf-minisearch/tree/main/packages/okf-minisearch)
- [Pinned OKF v0.2 specification](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md)

## License

MIT. See the repository [LICENSE](https://github.com/robhowley/okf-minisearch/blob/main/LICENSE).
