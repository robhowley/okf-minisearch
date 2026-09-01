import { describe, expect, it } from "vitest";

import { createPrepareBundleSentinel } from "../src/index.js";

describe("private preparation bundle sentinel", () => {
  it("returns its exact standalone marker", () => {
    expect(createPrepareBundleSentinel()).toEqual({
      marker: "okf-prepare-bundled",
      value: 73,
    });
  });
});
