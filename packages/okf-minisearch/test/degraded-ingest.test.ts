import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  openOkf,
  validateOkfDocument,
} from "../src/index.js";
import type {
  OkfDiagnostic,
  OkfSearch,
} from "../src/index.js";
import {
  concept,
  createBundle,
  type TestBundle,
} from "./support/bundle.js";

const bundles: TestBundle[] = [];

const mixedInput = {
  path: "./nested//derived-title.md",
  markdown: concept(`
    type: mixed-type
    title: {malformedtitlesentinel: true}
    description: validdescriptionsalvage
    resource: {malformedresourcesentinel: true}
    tags:
      - validtagsalvage
      - {malformedtagsentinel: true}
    sources:
      - resource: {malformedsourceresourcesentinel: true}
        id: validsourceidsalvage
        title: validsourcetitlesalvage
        author: producerauthor/version
      - resource: validsourceresourcesalvage
        id: {malformedsourceidsentinel: true}
        author: malformedsourcesauthorsentinel
      - malformedsourcesentinel
    verified:
      - by: invalid actor
        at: never
      - by: human:reviewer
        at: 2026-08-24T10:00:00Z
    status: malformedstatussentinel
    stale_after: malformedstalesentinel
  `, "mixedbodyneedle"),
};

const invalidOnlyInput = {
  path: "z-invalid-verification.md",
  markdown: concept(`
    type: invalid-facets
    verified:
      - by: invalid actor
        at: never
    status: invalidonlystatussentinel
    stale_after: invalidonlystalesentinel
  `, "invalidonlyneedle"),
};

const mixedDiagnosticFields = [
  "title",
  "resource",
  "tags[1]",
  "sources[0].resource",
  "sources[1].id",
  "sources[1].author",
  "sources[2]",
  "verified[0].by",
  "verified[0].at",
  "status",
  "stale_after",
];

function fields(
  diagnostics: readonly OkfDiagnostic[],
): Array<string | undefined> {
  return diagnostics.map((diagnostic) => diagnostic.field);
}

function expectOneDocument(
  okf: OkfSearch,
  query: string,
  fieldsToSearch?: Parameters<OkfSearch["search"]>[1],
): void {
  expect(okf.search(query, fieldsToSearch)).toEqual([
    expect.objectContaining({
      documentId: "nested/derived-title",
      path: "nested/derived-title.md",
      conformance: "degraded",
    }),
  ]);
}

afterEach(async () => {
  await Promise.all(
    bundles.splice(0).map((bundle) => bundle.cleanup()),
  );
});

describe("degraded direct ingest", () => {
  it("salvages valid values and keeps malformed-present facets unclassified", async () => {
    const tree = await createBundle({});
    bundles.push(tree);
    const okf = await openOkf(tree.root);

    const validation = validateOkfDocument(mixedInput);
    expect(validation).toMatchObject({
      isValid: false,
      isIndexable: true,
    });
    expect(fields(validation.errors)).toEqual(mixedDiagnosticFields);

    const degraded = okf.ingest(mixedInput);
    expect(Object.keys(degraded)).toEqual([
      "conformance",
      "documentId",
      "path",
      "diagnostics",
    ]);
    expect(Object.hasOwn(degraded, "document")).toBe(false);
    expect(Object.hasOwn(degraded, "records")).toBe(false);
    if (degraded.conformance !== "degraded") {
      expect.unreachable("malformed optional metadata must return the degraded arm");
    }
    expect(degraded).toMatchObject({
      documentId: "nested/derived-title",
      path: "nested/derived-title.md",
    });
    expect(degraded.diagnostics).toEqual(validation.errors);
    expect(degraded.diagnostics).not.toBe(validation.errors);
    expect(degraded.diagnostics[0]).not.toBe(validation.errors[0]);

    const mixedHits = okf.search("mixedbodyneedle");
    expect(mixedHits).toEqual([
      expect.objectContaining({
        documentId: "nested/derived-title",
        conformance: "degraded",
      }),
    ]);
    expect(Object.hasOwn(mixedHits[0]!, "diagnostics")).toBe(false);
    expect(okf.search("mixedbodyneedle", {
      where: { conformance: ["degraded"] },
    })).toEqual([
      expect.objectContaining({
        documentId: "nested/derived-title",
        conformance: "degraded",
      }),
    ]);
    expect(okf.search("mixedbodyneedle", {
      where: { conformance: ["strict"] },
    })).toEqual([]);
    expectOneDocument(okf, "validdescriptionsalvage", {
      fields: ["description"],
    });
    expectOneDocument(okf, "validtagsalvage", {
      fields: ["tags"],
    });
    for (const source of [
      "validsourceidsalvage",
      "validsourcetitlesalvage",
      "producerauthor",
      "validsourceresourcesalvage",
    ]) {
      expectOneDocument(okf, source, { fields: ["sources"] });
    }
    expectOneDocument(okf, "mixedbodyneedle", {
      where: {
        conformance: ["degraded"],
        types: ["mixed-type"],
        trustTiers: [
          "unverified",
          "machine-confirmed",
          "human-reviewed",
        ],
      },
    });
    expect(okf.search("mixedbodyneedle", {
      where: {
        conformance: ["degraded"],
        statuses: ["draft", "stable", "deprecated"],
      },
    })).toEqual([]);

    for (const malformed of [
      "malformedtitlesentinel",
      "malformedresourcesentinel",
      "malformedtagsentinel",
      "malformedsourceresourcesentinel",
      "malformedsourceidsentinel",
      "malformedsourcesauthorsentinel",
      "malformedsourcesentinel",
      "malformedstatussentinel",
      "malformedstalesentinel",
    ]) {
      expect(okf.search(malformed)).toEqual([]);
    }
    expect(okf.search("derived-title", {
      fields: ["title"],
    })).toEqual([]);
    expect(okf.search("mixedbodyneedle", {
      where: {
        statuses: ["draft", "stable", "deprecated"],
      },
    })).toEqual([]);
    for (const stale of [false, true]) {
      expect(okf.search("mixedbodyneedle", {
        asOf: new Date("2026-08-24T12:00:00Z"),
        where: {
          conformance: ["degraded"],
          stale,
        },
      })).toEqual([]);
    }

    degraded.diagnostics[0]!.message = "caller mutation";
    Array.prototype.push.call(degraded.diagnostics, {
      code: "ERR_OKF_FIELD",
      path: "caller.md",
      message: "caller mutation",
    });
    expect(fields(okf.listDegradedDocuments()[0]!.diagnostics))
      .toEqual(mixedDiagnosticFields);

    const invalidOnly = okf.ingest(invalidOnlyInput);
    if (invalidOnly.conformance !== "degraded") {
      expect.unreachable("invalid verification must return the degraded arm");
    }
    expect(fields(invalidOnly.diagnostics)).toEqual([
      "verified[0].by",
      "verified[0].at",
      "status",
      "stale_after",
    ]);
    const invalidOnlyHits = okf.search("invalidonlyneedle");
    expect(invalidOnlyHits).toEqual([
      expect.objectContaining({
        documentId: "z-invalid-verification",
        conformance: "degraded",
      }),
    ]);
    expect(Object.hasOwn(invalidOnlyHits[0]!, "diagnostics")).toBe(false);
    expect(okf.search("invalidonlyneedle", {
      where: {
        conformance: ["degraded"],
        types: ["invalid-facets"],
      },
    })).toEqual([
      expect.objectContaining({
        documentId: "z-invalid-verification",
        conformance: "degraded",
      }),
    ]);
    expect(okf.search("invalidonlyneedle", {
      where: { conformance: ["strict"] },
    })).toEqual([]);
    expect(okf.search("invalidonlyneedle", {
      where: {
        conformance: ["degraded"],
        trustTiers: [
          "unverified",
          "machine-confirmed",
          "human-reviewed",
        ],
      },
    })).toEqual([]);
    expect(okf.search("invalidonlyneedle", {
      where: {
        conformance: ["degraded"],
        statuses: ["draft", "stable", "deprecated"],
      },
    })).toEqual([]);
    for (const stale of [false, true]) {
      expect(okf.search("invalidonlyneedle", {
        asOf: new Date("2026-08-24T12:00:00Z"),
        where: {
          conformance: ["degraded"],
          stale,
        },
      })).toEqual([]);
    }
  });
});
