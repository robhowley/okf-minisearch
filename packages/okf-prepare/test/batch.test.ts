import { fromMarkdown } from "mdast-util-from-markdown";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PrepareError,
  prepareOkfDocuments,
} from "../src/index.js";
import { concept } from "./support/bundle.js";

vi.mock("mdast-util-from-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mdast-util-from-markdown")>();
  return { fromMarkdown: vi.fn(actual.fromMarkdown) };
});

beforeEach(() => {
  vi.mocked(fromMarkdown).mockClear();
});

describe("prepareOkfDocuments", () => {
  it("returns an empty batch without parsing", () => {
    expect(prepareOkfDocuments([])).toEqual([]);
    expect(fromMarkdown).not.toHaveBeenCalled();
  });

  it("normalizes and sorts by case-sensitive path while preserving backslashes", () => {
    const result = prepareOkfDocuments([
      { path: "z.md", markdown: concept("type: z") },
      { path: "folder\\name.md", markdown: concept("type: backslash") },
      { path: "./a//nested.md", markdown: concept("type: nested") },
      { path: "A.md", markdown: concept("type: upper") },
    ]);

    expect(result.map(({ identity, type }) => ({ ...identity, type }))).toEqual([
      { path: "A.md", documentId: "A", type: "upper" },
      { path: "a/nested.md", documentId: "a/nested", type: "nested" },
      {
        path: "folder\\name.md",
        documentId: "folder\\name",
        type: "backslash",
      },
      { path: "z.md", documentId: "z", type: "z" },
    ]);
    expect(fromMarkdown).toHaveBeenCalledTimes(4);
  });

  it("rejects the second duplicate before Markdown analysis", () => {
    expect(() => prepareOkfDocuments([
      { path: "./nested//guide.md", markdown: concept("type: first") },
      { path: "nested/guide.md", markdown: "invalid markdown" },
    ])).toThrow(expect.objectContaining({
      code: "ERR_OKF_FIELD",
      path: "nested/guide.md",
      field: "path",
    }));
    expect(fromMarkdown).not.toHaveBeenCalled();
  });

  it("normalizes all identities in caller order before content analysis", () => {
    expect(() => prepareOkfDocuments([
      { path: "z.md", markdown: "not frontmatter" },
      { path: "../unsafe.md", markdown: concept("type: unsafe") },
    ])).toThrow(expect.objectContaining({
      code: "ERR_OKF_FIELD",
      path: "<input>",
      field: "path",
    }));
    expect(fromMarkdown).not.toHaveBeenCalled();
  });

  it("throws the first fatal analysis in sorted order without returning a partial batch", () => {
    let returned: ReturnType<typeof prepareOkfDocuments> | undefined;
    let thrown: unknown;

    try {
      returned = prepareOkfDocuments([
        { path: "z.md", markdown: concept("type: '   '") },
        { path: "a.md", markdown: "not frontmatter" },
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(returned).toBeUndefined();
    expect(thrown).toBeInstanceOf(PrepareError);
    expect(thrown).toMatchObject({
      code: "ERR_OKF_PARSE",
      path: "a.md",
    });
    expect(fromMarkdown).not.toHaveBeenCalled();
  });
});
