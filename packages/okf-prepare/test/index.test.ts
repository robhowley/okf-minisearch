import { describe, expect, it } from "vitest";

import * as node from "../src/node.js";
import * as root from "../src/index.js";
import {
  PrepareError,
  createPrepareBundleSentinel,
  normalizeOkfDocumentIdentity,
  prepareOkfDocument,
  prepareOkfDocuments,
  validateOkfDocument,
} from "../src/index.js";

describe("private preparation package", () => {
  it("keeps root and Node runtime exports separate", () => {
    expect(Object.keys(root).sort()).toEqual([
      "PrepareError",
      "createPrepareBundleSentinel",
      "normalizeOkfDocumentIdentity",
      "prepareOkfDocument",
      "prepareOkfDocuments",
      "validateOkfDocument",
    ]);
    expect(root).not.toHaveProperty("readOkfDocuments");
    expect(Object.keys(node).sort()).toEqual(["readOkfDocuments"]);
  });

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
