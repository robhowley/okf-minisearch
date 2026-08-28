import {
  readFile,
} from "node:fs/promises";
import { join } from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  OkfError,
  openOkf,
} from "../src/index.js";
import {
  concept,
  createBundle,
  type TestBundle,
} from "./support/bundle.js";

const bundles: TestBundle[] = [];

afterEach(async () => {
  await Promise.all(
    bundles.splice(0).map((bundle) =>
      bundle.cleanup()),
  );
});

async function emptySearch() {
  const tree = await createBundle({});
  bundles.push(tree);
  return openOkf(tree.root);
}

describe("remove", () => {
  it("removes one document, preserves unrelated records, and reports absence", async () => {
    const okf = await emptySearch();

    okf.ingest({
      path: "target.md",
      markdown: concept("type: target", "removedneedle"),
    });
    okf.ingest({
      path: "other.md",
      markdown: concept("type: other", "preservedneedle"),
    });

    expect(okf.remove("./target.md")).toBe(true);
    expect(okf.search("removedneedle")).toEqual([]);
    expect(okf.search("preservedneedle")).toEqual([
      expect.objectContaining({
        documentId: "other",
        path: "other.md",
      }),
    ]);
    expect(okf.remove("target.md")).toBe(false);
    expect(okf.remove("absent.md")).toBe(false);
  });

  it("removes degraded records, type, and inventory in one transition", async () => {
    const okf = await emptySearch();
    const result = okf.ingest({
      path: "./nested//degraded.md",
      markdown: concept(
        "type: degraded/custom\nstatus: future",
        "# Section\ndegradedsectionneedle\n\n## Child\ndegradedchildneedle",
      ),
    });

    expect(result.conformance).toBe("degraded");
    expect(okf.search("degradedsectionneedle")).toHaveLength(1);
    expect(okf.search("degradedchildneedle")).toHaveLength(1);
    expect(okf.listTypes()).toEqual(["degraded/custom"]);
    expect(okf.listDegradedDocuments()).toEqual([
      expect.objectContaining({
        documentId: "nested/degraded",
        path: "nested/degraded.md",
      }),
    ]);

    expect(okf.remove("nested/degraded.md")).toBe(true);
    expect(okf.search("degradedsectionneedle")).toEqual([]);
    expect(okf.search("degradedchildneedle")).toEqual([]);
    expect(okf.listTypes()).toEqual([]);
    expect(okf.listDegradedDocuments()).toEqual([]);
    expect(okf.remove("./nested//degraded.md")).toBe(false);
  });

  it("uses one identity for aliases while keeping case and backslashes significant", async () => {
    const okf = await emptySearch();

    okf.ingest({
      path: "a/b.md",
      markdown: concept("type: nested", "nestedneedle"),
    });
    okf.ingest({
      path: "Guide.md",
      markdown: concept("type: upper", "upperneedle"),
    });
    okf.ingest({
      path: "guide.md",
      markdown: concept("type: lower", "lowerneedle"),
    });
    okf.ingest({
      path: "a\\b.md",
      markdown: concept("type: literal", "backslashneedle"),
    });

    expect(okf.remove("./a//b.md")).toBe(true);
    expect(okf.search("nestedneedle")).toEqual([]);
    expect(okf.search("backslashneedle")).toEqual([
      expect.objectContaining({
        documentId: "a\\b",
        path: "a\\b.md",
      }),
    ]);

    expect(okf.remove("guide.md")).toBe(true);
    expect(okf.search("lowerneedle")).toEqual([]);
    expect(okf.search("upperneedle")).toEqual([
      expect.objectContaining({
        documentId: "Guide",
        path: "Guide.md",
      }),
    ]);
  });

  it("removes every section and chunk record", async () => {
    const okf = await emptySearch();
    const chunkTerms = [
      "chunkalpha",
      "chunkbravo",
      "chunkcharlie",
      "chunkdelta",
      "chunkecho",
      "chunkfoxtrot",
      "chunkgolf",
      "chunkhotel",
      "chunkindia",
      "chunkjuliet",
    ];
    const paragraphs = chunkTerms.map((term) =>
      `${term} ${"filler ".repeat(100).trim()}`,
    );
    okf.ingest({
      path: "sections.md",
      markdown: concept(
        "type: sections",
        `# First
sectionfirstneedle

## Nested
sectionnestedneedle

# Chunks
${paragraphs.join("\n\n")}`,
      ),
    });

    for (const term of [
      "sectionfirstneedle",
      "sectionnestedneedle",
      ...chunkTerms,
    ]) {
      expect(okf.search(term)).toEqual([
        expect.objectContaining({ documentId: "sections" }),
      ]);
    }

    expect(okf.remove("sections.md")).toBe(true);
    for (const term of [
      "sectionfirstneedle",
      "sectionnestedneedle",
      ...chunkTerms,
    ]) {
      expect(okf.search(term)).toEqual([]);
    }
    expect(okf.remove("sections.md")).toBe(false);
  });

  it("does not touch startup files and allows a fresh re-ingest", async () => {
    const tree = await createBundle({
      "startup.md": concept("type: startup", "startupneedle"),
      "other.md": concept("type: other", "otherneedle"),
    });
    bundles.push(tree);
    const before = await readFile(join(tree.root, "startup.md"));
    const okf = await openOkf(tree.root);

    expect(okf.remove("./startup.md")).toBe(true);
    expect(await readFile(join(tree.root, "startup.md"))).toEqual(before);
    expect(okf.search("startupneedle")).toEqual([]);
    expect(okf.search("otherneedle")).toHaveLength(1);

    const reopened = await openOkf(tree.root);
    expect(reopened.search("startupneedle")).toHaveLength(1);

    okf.ingest({
      path: "startup.md",
      markdown: concept("type: replacement", "freshneedle"),
    });
    expect(okf.search("startupneedle")).toEqual([]);
    expect(okf.search("freshneedle", {
      where: { types: ["replacement"] },
    })).toEqual([
      expect.objectContaining({
        documentId: "startup",
      }),
    ]);
  });

  it.each([
    ["empty", "", "<input>"],
    ["dot-only", ".", "<input>"],
    ["dot aliases", "././", "<input>"],
    ["terminal slash", "manual.md/", "<input>"],
    ["terminal dot", "manual.md/.", "<input>"],
    ["POSIX absolute", "/private/secret.md", "<input>"],
    ["drive absolute", "C:/secret.md", "<input>"],
    ["drive backslash", "C:\\secret.md", "<input>"],
    ["drive relative", "C:secret.md", "<input>"],
    ["UNC", "\\\\server\\share.md", "<input>"],
    ["leading traversal", "../secret.md", "<input>"],
    ["nested traversal", "a/../secret.md", "<input>"],
    ["bad extension", "./notes.MD", "notes.MD"],
    ["reserved index", "./nested//index.md", "nested/index.md"],
    ["reserved log", "nested/./log.md", "nested/log.md"],
  ])("rejects %s before mutation", async (
    _case,
    path,
    ownedPath,
  ) => {
    const okf = await emptySearch();
    okf.ingest({
      path: "seed.md",
      markdown: concept("type: seed", "preservedseedword"),
    });

    let failure: unknown;
    try {
      okf.remove(path);
      expect.unreachable("remove should fail");
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(OkfError);
    expect(failure).toMatchObject({
      code: "ERR_OKF_FIELD",
      path: ownedPath,
      field: "path",
      message: `Invalid OKF field: ${ownedPath} (path)`,
    });
    expect(okf.search("preservedseedword")).toEqual([
      expect.objectContaining({
        documentId: "seed",
        path: "seed.md",
      }),
    ]);
  });
});
