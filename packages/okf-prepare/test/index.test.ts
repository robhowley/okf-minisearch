import { describe, expect, it } from "vitest";

import {
  PrepareError,
  createPrepareBundleSentinel,
  normalizeOkfDocumentIdentity,
  prepareOkfDocument,
  prepareOkfDocuments,
  validateOkfDocument,
} from "../src/index.js";

describe("private preparation package", () => {
  it("retains its exact standalone bundle marker", () => {
    expect(createPrepareBundleSentinel()).toEqual({
      marker: "okf-prepare-bundled",
      value: 73,
    });
  });

  it("exports the preparation runtime contracts from its root", () => {
    expect(PrepareError).toBeTypeOf("function");
    expect(normalizeOkfDocumentIdentity).toBeTypeOf("function");
    expect(prepareOkfDocument).toBeTypeOf("function");
    expect(prepareOkfDocuments).toBeTypeOf("function");
    expect(validateOkfDocument).toBeTypeOf("function");
  });
});
