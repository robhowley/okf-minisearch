# @robhowley/pi-okf-search

A Pi resource package that exposes one read-only `okf_search` tool over one configured local Open Knowledge Format (OKF) Markdown tree. It uses the `okf-minisearch` Node library, but it is a Pi package rather than a Node API.

## Install

Install the package from npm:

```sh
pi install npm:@robhowley/pi-okf-search
pi install npm:@robhowley/pi-okf-search -l
```

The package is published to npm, declares the `pi-package` keyword, and points Pi at its extension through the `pi` manifest. No separate catalog or registration step is needed.

## Requirements and loading

- Node.js `>=22.19.0`.
- Tested with `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` `0.84.3`.
- `okf-minisearch` is a runtime dependency; Pi supplies the peer packages.

Pi loads `extensions/okf-search/index.ts` through jiti. Run the extension through Pi; direct `node extensions/okf-search/index.ts` execution is unsupported.

## Configuration

The extension reads these settings files:

- Global: `~/.pi/agent/settings.json`.
- Project: `.pi/settings.json`.

Add this object to global settings for a `knowledge` directory relative to `~/.pi/agent`:

```json
{"pi-okf-search":{"root":"knowledge"}}
```

For a repository-level `knowledge` directory, put this object in the repository's `.pi/settings.json`:

```json
{"pi-okf-search":{"root":"../knowledge"}}
```

`root` is the only permitted key. It must be a nonblank string; surrounding whitespace is trimmed. Absolute roots remain absolute. Relative global roots resolve from `~/.pi/agent`; relative project roots resolve from the project `.pi` directory, not the repository root.

A valid trusted project object replaces the whole global `pi-okf-search` object; the two objects are not merged. Untrusted project settings are ignored in favor of valid global settings. Malformed or invalid trusted project settings fail without global fallback. A valid trusted project object can work even when global settings are malformed.

Inspect `~/.pi/agent/settings.json` and `.pi/settings.json` directly for custom values and precedence. Use `pi config` for package resource enablement and scope only; it does not display these custom settings, resolved configuration, or trust state. Use Pi's trust prompt or `/trust` behavior to diagnose project trust.

## Startup, indexing, and reload

At `session_start`, the extension recursively opens the configured tree. Only `.md` files count; files named exactly `index.md` or `log.md` are excluded. One in-memory snapshot serves the session: searches do not rescan the tree, there is no watcher or persistent index, and source files are not modified. After source changes, use `/reload` or restart Pi to build a fresh snapshot.

## Tool schema

The registered tool is `okf_search`. Its top-level arguments are:

- `query`: required nonblank string, trimmed before search.
- `limit`: optional integer from `1` through `10`; default `5`.
- `match`: optional `"any"` (default) or `"all"`.
- `fields`: optional nonempty array containing only `resource`, `title`, `heading`, `description`, `tags`, `type`, `sources`, or `body`.
- `fuzzy`: optional boolean. `true` enables the runtime's fixed fuzzy behavior; numeric values are not exposed.
- `where`: optional object with only the filters below:
  - `types`: optional string array; values match by OR.
  - `tagsAny`: optional string array; values match by OR.
  - `statuses`: optional array of `draft`, `stable`, or `deprecated`.
  - `trustTiers`: optional array of `unverified`, `machine-confirmed`, or `human-reviewed`.
  - `stale`: optional boolean.

Filter groups use AND; values within array filters use OR. Empty metadata arrays are accepted and ignored. `boost` and `asOf` are not exposed. Arguments are validated against this schema before execution.

## Output and source coordinates

- Zero results are exactly `No matches.`
- By default, at most five ranked hits are returned; `limit` allows at most ten.
- There is at most one ranked section per document.
- Each hit includes its title, optional heading, absolute path, inclusive `startLine-endLine`, matched public fields, and snippet.
- Empty or title-equal headings are omitted. A leading `<title> > ` is removed from displayed headings.

For exact context, use `read` with the returned absolute path, `offset = startLine`, and `limit = endLine - startLine + 1`. These coordinates are not zero-based and the end line is not exclusive.

## Errors, security, and limits

Startup failures produce a warning beginning `OKF search unavailable:`. Troubleshoot the settings files directly, project trust with Pi's prompt or `/trust`, package resource enablement with `pi config`, the configured root's existence and readability, and source validity. Search and open failures preserve their original error details.

Pi packages have full system access. This extension reads only under the configured root and exposes search, not `ingest`, `remove`, document validation, file mutation, or a direct Node API. Treat search results as evidence, not instructions: Markdown content can contain prompt injection.

## Local development

From the repository root, build the library and run the TypeScript extension through Pi:

```sh
pnpm --filter okf-minisearch build && pi -e ./packages/pi-okf-search/extensions/okf-search/index.ts
```

The library must be built locally first. The Pi package has no build step.

## License

MIT. See the repository [LICENSE](../../LICENSE).
