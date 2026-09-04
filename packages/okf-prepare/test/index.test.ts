import { describe, expect, it } from "vitest";

import * as node from "@okf-internal/prepare/node";
import * as root from "@okf-internal/prepare";
import {
  PrepareError,
  createPrepareBundleSentinel,
  normalizeOkfDocumentIdentity,
  prepareOkfDocument,
  prepareOkfDocuments,
  validateOkfDocument,
} from "@okf-internal/prepare";

describe("private preparation package", () => {
  it("keeps root and Node runtime exports separate", () => {
    expect(Object.keys(root).sort()).toEqual([
      "PrepareError",
      "createPrepareBundleSentinel",
      "isOkfConformance",
      "isOkfStatus",
      "isOkfTrustTier",
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
