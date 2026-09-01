import { describe, expect, it } from "vitest";

import {
  PrepareError,
  type PrepareErrorCode,
} from "../src/index.js";

describe("PrepareError", () => {
  it.each<[
    PrepareErrorCode,
    string,
    string,
    string,
  ]>([
    [
      "ERR_OKF_READ",
      "notes.md",
      "",
      "Cannot read OKF path: notes.md",
    ],
    [
      "ERR_OKF_PARSE",
      "notes.md",
      "frontmatter",
      "Cannot parse OKF concept: notes.md (frontmatter)",
    ],
    [
      "ERR_OKF_FIELD",
      "notes.md",
      "title",
      "Invalid OKF field: notes.md (title)",
    ],
  ])("uses the exact %s message", (code, path, field, message) => {
    const error = new PrepareError(
      code,
      path,
      field ? { field } : undefined,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(PrepareError);
    expect(error.name).toBe("PrepareError");
    expect(error.code).toBe(code);
    expect(error.path).toBe(path);
    expect(error.message).toBe(message);
    expect(Object.hasOwn(error, "field")).toBe(Boolean(field));
  });

  it("retains a supplied cause without adding one by default", () => {
    const withoutCause = new PrepareError("ERR_OKF_READ", "notes.md");
    expect(Object.hasOwn(withoutCause, "cause")).toBe(false);

    const cause = new Error("read failed");
    const withCause = new PrepareError("ERR_OKF_READ", "notes.md", { cause });
    expect(Object.hasOwn(withCause, "cause")).toBe(true);
    expect(withCause.cause).toBe(cause);
  });

  it("keeps field ownership separate from the message subject", () => {
    const error = new PrepareError("ERR_OKF_FIELD", "notes.md", { field: "" });

    expect(Object.hasOwn(error, "field")).toBe(true);
    expect(error.field).toBe("");
    expect(error.message).toBe("Invalid OKF field: notes.md");
  });
});
