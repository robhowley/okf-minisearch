import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import { createRuntime } from "../extensions/okf-search/runtime.js";

const STALE_PAST = "2000-01-01T00:00:00Z";
const STALE_FUTURE = "2999-01-01T00:00:00Z";
const VERIFIED_AT = "2026-08-24T10:00:00Z";

const draft = [
  "---",
  "type: note",
  "title: Recovery",
  "status: draft",
  `stale_after: ${STALE_PAST}`,
  "---",
  "# Recovery",
  "",
  "## Restart",
  "adaptercoordinate inclusiveomission",
].join("\n");

const stable = [
  "---",
  "type: note",
  "title: Stable",
  "status: stable",
  `stale_after: ${STALE_FUTURE}`,
  "verified:",
  "  by: process:builder",
  `  at: ${VERIFIED_AT}`,
  "---",
  "inclusiveomission",
].join("\n");

const deprecated = [
  "---",
  "type: note",
  "title: Deprecated",
  "status: deprecated",
  `stale_after: ${STALE_FUTURE}`,
  "verified:",
  "  by: human:alice",
  `  at: ${VERIFIED_AT}`,
  "---",
  "inclusiveomission",
].join("\n");

const reservedIndex = [
  "---",
  "type: note",
  "title: Reserved",
  "status: stable",
  `stale_after: ${STALE_FUTURE}`,
  "---",
  "inclusiveomission",
].join("\n");

function rootRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

describe("OKF search real-tree integration", () => {
  it("opens, searches, and retains a snapshot of one filesystem tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-okf-search-"));
    let configCalls = 0;

    try {
      await mkdir(join(root, "guides"), { recursive: true });
      await mkdir(join(root, "reserved"), { recursive: true });
      await Promise.all([
        writeFile(join(root, "guides/draft.md"), draft),
        writeFile(join(root, "guides/stable.md"), stable),
        writeFile(join(root, "guides/deprecated.md"), deprecated),
        writeFile(join(root, "reserved/index.md"), reservedIndex),
      ]);

      const runtime = createRuntime({
        loadConfig: () => {
          configCalls += 1;
          return { root };
        },
      });
      const ctx = {
        cwd: root,
        isProjectTrusted: () => true,
      };

      const coordinateHits = await runtime.search(ctx, {
        query: "adaptercoordinate",
      });
      expect(coordinateHits).toHaveLength(1);
      expect(coordinateHits[0]).toMatchObject({
        title: "Recovery",
        headingPath: "Recovery > Restart",
        absolutePath: resolve(root, "guides/draft.md"),
        startLine: 9,
        endLine: 10,
      });

      const omissionHits = await runtime.search(ctx, {
        query: "inclusiveomission",
        limit: 10,
      });
      expect(
        omissionHits
          .map((hit) => rootRelative(root, hit.absolutePath))
          .sort(),
      ).toEqual([
        "guides/deprecated.md",
        "guides/draft.md",
        "guides/stable.md",
      ]);

      const draftPath = join(root, "guides/draft.md");
      const rewritten = (await readFile(draftPath, "utf8"))
        .replace("adaptercoordinate", "replacementterm");
      await writeFile(draftPath, rewritten);

      const cachedOldHits = await runtime.search(ctx, {
        query: "adaptercoordinate",
      });
      const cachedReplacementHits = await runtime.search(ctx, {
        query: "replacementterm",
      });

      expect(cachedOldHits).toHaveLength(1);
      expect(cachedOldHits[0]?.absolutePath).toBe(
        resolve(root, "guides/draft.md"),
      );
      expect(cachedReplacementHits).toEqual([]);
      expect(configCalls).toBe(1);
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
      });
    }
  });

  it("uses Pi defaults for OR, 0.2 fuzzy matching, and final-term prefixes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-okf-search-"));

    try {
      await Promise.all([
        writeFile(
          join(root, "or.md"),
          [
            "---",
            "type: note",
            "title: OR guide",
            "---",
            "oronlyterm",
          ].join("\n"),
        ),
        writeFile(
          join(root, "threshold.md"),
          [
            "---",
            "type: note",
            "title: Threshold guide",
            "---",
            "abcdefghij",
          ].join("\n"),
        ),
        writeFile(
          join(root, "completion.md"),
          [
            "---",
            "type: note",
            "title: Prefix guide",
            "---",
            "prefixcompletion",
          ].join("\n"),
        ),
      ]);

      const runtime = createRuntime({
        loadConfig: () => ({ root }),
      });
      const ctx = {
        cwd: root,
        isProjectTrusted: () => true,
      };

      const defaultHits = await runtime.search(ctx, {
        query: "oronlyterm abxdeyghij prefix",
      });
      expect(defaultHits.map((hit) => rootRelative(root, hit.absolutePath)).sort())
        .toEqual(["completion.md", "or.md", "threshold.md"]);

      expect(await runtime.search(ctx, {
        query: "abxdeyghij",
        fuzzy: 0.1,
      })).toEqual([]);
      expect((await runtime.search(ctx, {
        query: "prefix",
        fuzzy: false,
      })).map((hit) => rootRelative(root, hit.absolutePath))).toEqual([
        "completion.md",
      ]);
    } finally {
      await rm(root, {
        recursive: true,
        force: true,
      });
    }
  });
});
