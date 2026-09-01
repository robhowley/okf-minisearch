import { describe, expect, it } from "vitest";

import {
  PrepareError,
  normalizeOkfDocumentIdentity,
} from "../src/index.js";

describe("normalizeOkfDocumentIdentity", () => {
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
  ])("rejects %s as an unsafe path", (_name, path, ownedPath) => {
    let failure: unknown;

    try {
      normalizeOkfDocumentIdentity(path);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(PrepareError);
    expect(failure).toMatchObject({
      code: "ERR_OKF_FIELD",
      path: ownedPath,
      field: "path",
      message: `Invalid OKF field: ${ownedPath} (path)`,
    });
    if (path) {
      expect((failure as Error).message).not.toContain(path);
    }
  });

  it.each([
    ["bad extension", "./notes.MD", "notes.MD"],
    ["missing extension", "notes", "notes"],
    ["reserved index", "./nested//index.md", "nested/index.md"],
    ["reserved log", "nested/./log.md", "nested/log.md"],
  ])("rejects %s using the normalized path", (_name, path, ownedPath) => {
    expect(() => normalizeOkfDocumentIdentity(path)).toThrowError(
      new PrepareError("ERR_OKF_FIELD", ownedPath, { field: "path" }),
    );
  });

  it("removes only empty and dot segments", () => {
    expect(normalizeOkfDocumentIdentity("./a//b/./c.md")).toEqual({
      path: "a/b/c.md",
      documentId: "a/b/c",
    });
  });

  it("preserves case, Unicode, and literal backslashes", () => {
    expect(normalizeOkfDocumentIdentity("Guide.md")).toEqual({
      path: "Guide.md",
      documentId: "Guide",
    });
    expect(normalizeOkfDocumentIdentity("café/Über.md")).toEqual({
      path: "café/Über.md",
      documentId: "café/Über",
    });
    expect(normalizeOkfDocumentIdentity("a\\b.md")).toEqual({
      path: "a\\b.md",
      documentId: "a\\b",
    });
  });

  it("requires an exact lowercase extension and reserved basename", () => {
    expect(normalizeOkfDocumentIdentity("INDEX.md")).toEqual({
      path: "INDEX.md",
      documentId: "INDEX",
    });
    expect(normalizeOkfDocumentIdentity("LOG.md")).toEqual({
      path: "LOG.md",
      documentId: "LOG",
    });
  });
});
