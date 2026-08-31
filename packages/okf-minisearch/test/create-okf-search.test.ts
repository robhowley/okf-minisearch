import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import MiniSearch from "minisearch";

import {
  OkfError,
  createOkfSearch,
} from "../src/index.js";
import type { OkfSearch } from "../src/index.js";
import { concept } from "./support/bundle.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function opened(
  documents: Parameters<typeof createOkfSearch>[0],
): OkfSearch {
  return createOkfSearch(documents);
}

describe("createOkfSearch", () => {
  it("constructs synchronously and exposes the complete mutable handle", () => {
    const okf = createOkfSearch([
      {
        path: "guide.md",
        markdown: concept("type: guide", "constructorneedle"),
      },
    ]);

    expect(okf).toMatchObject({
      ingest: expect.any(Function),
      listDegradedDocuments: expect.any(Function),
      listTypes: expect.any(Function),
      remove: expect.any(Function),
      search: expect.any(Function),
      autoSuggest: expect.any(Function),
    });
    expect(okf.search("constructorneedle")).toHaveLength(1);
    expect(okf.autoSuggest("constructorneed")).toEqual([
      expect.objectContaining({ suggestion: "constructorneedle" }),
    ]);

    const result = okf.ingest({
      path: "added.md",
      markdown: concept("type: added", "addedneedle"),
    });
    expect(result.conformance).toBe("strict");
    expect(okf.listTypes()).toEqual(["added", "guide"]);
    expect(okf.remove("added.md")).toBe(true);
    expect(okf.search("addedneedle")).toEqual([]);
  });

  it("snapshots caller containers and input objects", () => {
    const input = {
      path: "original.md",
      markdown: concept("type: original", "originalneedle"),
    };
    const inputs = [input];
    const okf = createOkfSearch(inputs);

    input.path = "changed.md";
    input.markdown = concept("type: changed", "changedneedle");
    inputs.push({
      path: "later.md",
      markdown: concept("type: later", "laterneedle"),
    });

    expect(okf.search("originalneedle")).toEqual([
      expect.objectContaining({
        documentId: "original",
        path: "original.md",
      }),
    ]);
    expect(okf.search("changedneedle")).toEqual([]);
    expect(okf.search("laterneedle")).toEqual([]);
    expect(okf.listTypes()).toEqual(["original"]);
  });

  it("normalizes and sorts before preparing and indexing documents", () => {
    const addAllSpy = vi.spyOn(MiniSearch.prototype, "addAll");

    expect(() => createOkfSearch([
      {
        path: "z-valid.md",
        markdown: concept("type: z", "zneedle"),
      },
      {
        path: "./nested//a-fatal.md",
        markdown: concept("type: '   '", "fatalneedle"),
      },
      {
        path: "m-valid.md",
        markdown: concept("type: m", "mneedle"),
      },
    ])).toThrowError(expect.objectContaining({
      code: "ERR_OKF_FIELD",
      path: "nested/a-fatal.md",
      field: "type",
    }));
    expect(addAllSpy).not.toHaveBeenCalled();

    const okf = opened([
      {
        path: "./z.md",
        markdown: concept("type: z", "same-score-needle"),
      },
      {
        path: "./nested//a.md",
        markdown: concept("type: a", "same-score-needle"),
      },
    ]);
    const startupRecords = addAllSpy.mock.calls[0]?.[0] ?? [];
    expect(startupRecords.map((record) => record.path)).toEqual([
      "nested/a.md",
      "z.md",
    ]);
    expect(okf.search("same-score-needle", { limit: 10 })
      .map((hit) => hit.path).sort()).toEqual([
      "nested/a.md",
      "z.md",
    ]);
  });

  it("rejects duplicate normalized identities before preparation or indexing", () => {
    const addAllSpy = vi.spyOn(MiniSearch.prototype, "addAll");

    expect(() => createOkfSearch([
      {
        path: "./nested//guide.md",
        markdown: concept("type: guide", "firstneedle"),
      },
      {
        path: "nested/guide.md",
        markdown: "not frontmatter",
      },
    ])).toThrowError(new OkfError(
      "ERR_OKF_FIELD",
      "nested/guide.md",
      { field: "path" },
    ));
    expect(addAllSpy).not.toHaveBeenCalled();
  });

  it.each(["index.md", "log.md", "UPPER.MD"])(
    "rejects invalid or reserved direct input instead of filtering it",
    (path) => {
      expect(() => createOkfSearch([{
        path,
        markdown: concept("type: note"),
      }])).toThrowError(expect.objectContaining({
        code: "ERR_OKF_FIELD",
        path,
        field: "path",
      }));
    },
  );

  it("keeps strict, degraded, and fatal inputs distinct", () => {
    const okf = createOkfSearch([
      {
        path: "strict.md",
        markdown: concept("type: strict", "strictneedle"),
      },
      {
        path: "degraded.md",
        markdown: concept("type: degraded\ntitle: 1", "degradedneedle"),
      },
    ]);

    expect(okf.listTypes()).toEqual(["degraded", "strict"]);
    expect(okf.listDegradedDocuments()).toEqual([
      expect.objectContaining({
        documentId: "degraded",
        path: "degraded.md",
      }),
    ]);
    expect(okf.search("strictneedle")).toHaveLength(1);
    expect(okf.search("degradedneedle")).toHaveLength(1);

    expect(() => okf.ingest({
      path: "fatal.md",
      markdown: concept("type: ' '", "fatalneedle"),
    })).toThrowError(expect.objectContaining({
      code: "ERR_OKF_FIELD",
      path: "fatal.md",
      field: "type",
    }));
    expect(okf.search("fatalneedle")).toEqual([]);
  });

  it("returns a usable empty handle", () => {
    const okf = createOkfSearch([]);

    expect(okf.listTypes()).toEqual([]);
    expect(okf.listDegradedDocuments()).toEqual([]);
    expect(okf.search("anything")).toEqual([]);
    expect(okf.autoSuggest("anything")).toEqual([]);
    expect(okf.remove("missing.md")).toBe(false);
  });

  it("does not expose a handle when initial indexing fails", () => {
    const rawError = new Error("injected startup add failure");
    const addAllSpy = vi.spyOn(MiniSearch.prototype, "addAll")
      .mockImplementation(() => {
        throw rawError;
      });

    expect(() => createOkfSearch([{
      path: "valid.md",
      markdown: concept("type: note", "startupneedle"),
    }])).toThrowError(rawError);
    expect(addAllSpy).toHaveBeenCalledTimes(1);
  });
});
