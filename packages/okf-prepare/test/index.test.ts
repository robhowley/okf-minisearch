import { describe, expect, it } from "vitest";

import {
  PrepareError,
  createPrepareBundleSentinel,
  normalizeOkfDocumentIdentity,
} from "../src/index.js";

describe("private preparation package", () => {
  it("retains its exact standalone bundle marker", () => {
    expect(createPrepareBundleSentinel()).toEqual({
      marker: "okf-prepare-bundled",
      value: 73,
    });
  });

  it("exports the foundation runtime contracts from its root", () => {
    expect(PrepareError).toBeTypeOf("function");
    expect(normalizeOkfDocumentIdentity).toBeTypeOf("function");
  });
});
