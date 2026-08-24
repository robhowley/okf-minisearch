import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import { openOkf } from "../src/index.js";
import type { OkfSearch } from "../src/index.js";
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

async function open(
  files: Record<string, string>,
): Promise<OkfSearch> {
  const tree = await createBundle(files);
  bundles.push(tree);
  return openOkf(tree.root);
}

describe("search identity and metadata", () => {
  it("does not search directory or file document IDs", async () => {
    const okf = await open({
      "directoryidneedle/plain.md": concept(`
        type: note
        title: Explicit Directory Title
      `, "Explicit directory body"),
      "plain/fileidneedle.md": concept(`
        type: note
        title: Explicit File Title
      `, "Explicit file body"),
    });

    expect(okf.search("directoryidneedle")).toEqual([]);
    expect(okf.search("fileidneedle")).toEqual([]);
  });

  it("does not favor a document ID match over identical topical text", async () => {
    const okf = await open({
      "topicalneedle/with-id.md": concept(`
        type: note
        title: Shared Topic
      `, "Shared topicalneedle body"),
      "plain/without-id.md": concept(`
        type: note
        title: Shared Topic
      `, "Shared topicalneedle body"),
    });

    const hits = okf.search("topicalneedle", {
      limit: 10,
    });
    const withDocumentId = hits.find((hit) =>
      hit.documentId === "topicalneedle/with-id");
    const withoutDocumentId = hits.find((hit) =>
      hit.documentId === "plain/without-id");

    expect(hits).toHaveLength(2);
    expect(withDocumentId).toBeDefined();
    expect(withoutDocumentId).toBeDefined();
    expect(withDocumentId!.score).toBe(
      withoutDocumentId!.score,
    );
    expect(withDocumentId!.matchedFields).toEqual(
      withoutDocumentId!.matchedFields,
    );
    expect(withDocumentId!.matchedFields).not.toContain(
      "documentId",
    );
  });

  it("returns document IDs and replaces records by logical identity", async () => {
    const okf = await open({});

    const added = okf.ingest({
      path: "identity/guide.md",
      markdown: concept(`
        type: note
        title: Stable Guide
      `, "oldtopicneedle"),
    });

    expect(added.records).toEqual([
      expect.objectContaining({
        documentId: "identity/guide",
        path: "identity/guide.md",
      }),
    ]);
    expect(okf.search("oldtopicneedle")).toEqual([
      expect.objectContaining({
        documentId: "identity/guide",
        path: "identity/guide.md",
      }),
    ]);

    const replacement = okf.ingest({
      path: "./identity//guide.md",
      markdown: concept(`
        type: changed
        title: Stable Guide
      `, "newtopicneedle"),
    });

    expect(replacement.document.id).toBe("identity/guide");
    expect(okf.search("oldtopicneedle")).toEqual([]);
    expect(okf.search("newtopicneedle")).toEqual([
      expect.objectContaining({
        documentId: "identity/guide",
        path: "identity/guide.md",
      }),
    ]);
  });

  it("filters by frontmatter type independently of document path", async () => {
    const okf = await open({
      "first/reference.md": concept(`
        type: note
        title: Reference Topic
      `, "Shared typefilterneedle body"),
      "second/guide.md": concept(`
        type: recipe
        title: Guide Topic
      `, "Shared typefilterneedle body"),
    });

    expect(okf.search("typefilterneedle", {
      limit: 10,
    }).map((hit) => hit.path).sort()).toEqual([
      "first/reference.md",
      "second/guide.md",
    ]);
    expect(okf.search("typefilterneedle", {
      where: { types: ["note"] },
    })).toEqual([
      expect.objectContaining({
        documentId: "first/reference",
        path: "first/reference.md",
      }),
    ]);
    expect(okf.search("typefilterneedle", {
      where: { types: ["recipe"] },
    })).toEqual([
      expect.objectContaining({
        documentId: "second/guide",
        path: "second/guide.md",
      }),
    ]);
  });
});
