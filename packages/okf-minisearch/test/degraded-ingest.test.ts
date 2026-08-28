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

    const strict = okf.ingest({
      path: "nested/derived-title.md",
      markdown: concept("type: initial-strict", "strictinitialneedle"),
    });
    if (strict.conformance !== "strict") {
      expect.unreachable("valid input must return the strict arm");
    }
    expect(strict.document.id).toBe("nested/derived-title");
    expect(okf.listDegradedDocuments()).toEqual([]);

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
      where: { trustTiers: ["human-reviewed"] },
    });

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
        where: { stale },
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
    expect(okf.search("invalidonlyneedle")).toHaveLength(1);
    expect(okf.search("invalidonlyneedle", {
      where: {
        trustTiers: [
          "unverified",
          "machine-confirmed",
          "human-reviewed",
        ],
      },
    })).toEqual([]);
    expect(okf.search("invalidonlyneedle", {
      where: {
        statuses: ["draft", "stable", "deprecated"],
      },
    })).toEqual([]);
    for (const stale of [false, true]) {
      expect(okf.search("invalidonlyneedle", {
        asOf: new Date("2026-08-24T12:00:00Z"),
        where: { stale },
      })).toEqual([]);
    }

    const firstInventory = okf.listDegradedDocuments();
    const secondInventory = okf.listDegradedDocuments();
    expect(firstInventory.map((entry) => entry.path)).toEqual([
      "nested/derived-title.md",
      "z-invalid-verification.md",
    ]);
    expect(firstInventory).not.toBe(secondInventory);
    expect(firstInventory[0]).not.toBe(secondInventory[0]);
    expect(firstInventory[0]!.diagnostics)
      .not.toBe(secondInventory[0]!.diagnostics);
    expect(firstInventory[0]!.diagnostics[0])
      .not.toBe(secondInventory[0]!.diagnostics[0]);
    firstInventory[0]!.diagnostics[0]!.message = "inventory mutation";
    expect(fields(okf.listDegradedDocuments()[0]!.diagnostics))
      .toEqual(mixedDiagnosticFields);

    expect(() => okf.ingest({
      path: "./nested//derived-title.md",
      markdown: concept("type: ' '", "fatalreplacementneedle"),
    })).toThrow(expect.objectContaining({
      code: "ERR_OKF_FIELD",
      path: "nested/derived-title.md",
      field: "type",
    }));
    expectOneDocument(okf, "mixedbodyneedle");
    expect(okf.search("fatalreplacementneedle")).toEqual([]);
    expect(okf.listDegradedDocuments()).toEqual(secondInventory);

    const degradedReplacement = okf.ingest({
      path: "nested/./derived-title.md",
      markdown: concept(`
        type: replacement-degraded
        title: {malformedreplacementtitlesentinel: true}
        description: validreplacementdescription
      `, "replacementdegradedneedle"),
    });
    if (degradedReplacement.conformance !== "degraded") {
      expect.unreachable("malformed replacement must return the degraded arm");
    }
    expect(fields(degradedReplacement.diagnostics)).toEqual(["title"]);
    expect(okf.search("mixedbodyneedle")).toEqual([]);
    expectOneDocument(okf, "replacementdegradedneedle");
    expect(okf.search("malformedreplacementtitlesentinel")).toEqual([]);
    expect(okf.search("derived-title", {
      fields: ["title"],
    })).toEqual([]);
    expect(okf.listDegradedDocuments().map((entry) => ({
      path: entry.path,
      fields: fields(entry.diagnostics),
    }))).toEqual([
      {
        path: "nested/derived-title.md",
        fields: ["title"],
      },
      {
        path: "z-invalid-verification.md",
        fields: [
          "verified[0].by",
          "verified[0].at",
          "status",
          "stale_after",
        ],
      },
    ]);

    const recovered = okf.ingest({
      path: "./nested/derived-title.md",
      markdown: concept("type: final-strict", "finalstrictneedle"),
    });
    if (recovered.conformance !== "strict") {
      expect.unreachable("valid recovery must return the strict arm");
    }
    expect(recovered.document.type).toBe("final-strict");
    expect(okf.search("replacementdegradedneedle")).toEqual([]);
    expectOneDocument(okf, "finalstrictneedle");
    expect(okf.listDegradedDocuments().map((entry) => entry.path)).toEqual([
      "z-invalid-verification.md",
    ]);
  });
});
