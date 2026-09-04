import { describe, expect, it } from "vitest";

import {
  prepareOkfDocument,
  type PreparedOkfDocument,
} from "@okf-internal/prepare";

import { concept } from "../../okf-prepare/test/support/bundle.js";
import {
  mapPreparedDocument,
  mapPreparedDocuments,
} from "../src/prepared-to-native.js";

function prepare(
  metadata: string,
  body = "body",
  path = "concept.md",
): PreparedOkfDocument {
  return prepareOkfDocument({
    path,
    markdown: concept(metadata, body),
  });
}

describe("mapPreparedDocument", () => {
  it("maps strict metadata, facets, identity, and ordered chunks", () => {
    const prepared = prepare(
      `
        type: note
        title: Native title
        description: Native description
        resource: https://example.test/resource
        tags: [alpha, beta]
        sources:
          - id: source-id
            title: Source title
            author: process:builder
            resource: https://example.test/source
        verified:
          by: human:reviewer
          at: 2026-08-24T10:00:00Z
        status: deprecated
        stale_after: 2026-08-24T11:00:00.1239+01:00
      `,
      "# Introduction\nintroneedle\n\n## Details\ndetailsneedle",
      "./nested//native.md",
    );

    expect(prepared.conformance).toBe("strict");
    if (prepared.conformance !== "strict") expect.unreachable();

    const mapped = mapPreparedDocument(prepared);
    const { documentId, path } = prepared.identity;

    expect(mapped).toEqual({
      documentId,
      path,
      type: "note",
      conformance: "strict",
      diagnostics: [],
      title: "Native title",
      tags: ["alpha", "beta"],
      status: "deprecated",
      staleAfterEpoch: Date.parse("2026-08-24T10:00:00.124Z"),
      stalenessClassified: true,
      trustTier: "human-reviewed",
      resource: "https://example.test/resource",
      description: "Native description",
      sourceText: "source-id Source title process:builder https://example.test/source",
      sections: prepared.sections.map((section) => ({
        sectionId: section.id,
        headingPath: section.headingPath,
        text: section.text,
        startLine: section.startLine,
        endLine: section.endLine,
      })),
    });
    expect(Object.keys(mapped.sections[0]!).sort()).toEqual([
      "endLine",
      "headingPath",
      "sectionId",
      "startLine",
      "text",
    ]);
  });

  it("maps degraded diagnostics and each facet's classification independently", () => {
    const prepared = prepare(`
      type: note
      title: Degraded title
      description: salvage
      tags: [kept]
      verified:
        - by: invalid actor
          at: never
        - by: human:reviewer
          at: 2026-08-24T10:00:00Z
      status: future
      stale_after: yesterday
    `, "degradedneedle", "./degraded.md");

    expect(prepared.conformance).toBe("degraded");
    if (prepared.conformance !== "degraded") expect.unreachable();

    const mapped = mapPreparedDocument(prepared);
    expect(mapped.documentId).toBe("degraded");
    expect(mapped.path).toBe("degraded.md");
    expect(mapped.conformance).toBe("degraded");
    expect(mapped.diagnostics).toEqual(
      prepared.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    );
    expect(mapped).toMatchObject({
      documentId: "degraded",
      path: "degraded.md",
      type: "note",
      conformance: "degraded",
      title: "Degraded title",
      description: "salvage",
      tags: ["kept"],
      trustTier: "human-reviewed",
      stalenessClassified: false,
      resource: "",
      sourceText: "",
    });
    expect(mapped.sections).toHaveLength(prepared.sections.length);
    expect(mapped.sections[0]).toEqual({
      sectionId: prepared.sections[0]!.id,
      headingPath: prepared.sections[0]!.headingPath,
      text: "degradedneedle",
      startLine: prepared.sections[0]!.startLine,
      endLine: prepared.sections[0]!.endLine,
    });
    expect(Object.hasOwn(mapped, "status")).toBe(false);
    expect(Object.hasOwn(mapped, "staleAfterEpoch")).toBe(false);
  });

  it("maps a classified facet without inventing an absent timestamp", () => {
    const prepared = prepare("type: note\nstatus: draft", "classifiedneedle");
    const mapped = mapPreparedDocument(prepared);

    expect(mapped).toMatchObject({
      status: "draft",
      trustTier: "unverified",
      stalenessClassified: true,
    });
    expect(Object.hasOwn(mapped, "staleAfterEpoch")).toBe(false);
  });

  it("detaches mutable DTO containers without repeating document metadata", () => {
    const prepared = prepare(
      "type: note\nstatus: future",
      "# First\nfirstneedle\n\n# Second\nsecondneedle",
      "detached.md",
    );
    expect(prepared.conformance).toBe("degraded");

    const mapped = mapPreparedDocument(prepared);
    const first = mapped.sections[0]!;
    const second = mapped.sections[1]!;

    expect(mapped).not.toBe(prepared);
    expect(mapped.diagnostics).not.toBe(prepared.diagnostics);
    expect(mapped.diagnostics[0]).not.toBe(prepared.diagnostics[0]);
    expect(mapped.sections).not.toBe(prepared.sections);
    expect(mapped.tags).not.toBe(prepared.metadata.tags);

    const preparedTags = prepared.metadata.tags as unknown as string[];
    const preparedDiagnostics = prepared.diagnostics as unknown as Array<{
      field?: string;
      message: string;
    }>;
    const preparedSections = prepared.sections as unknown as Array<{ text: string }>;
    preparedTags.push("prepared-mutation");
    preparedDiagnostics[0]!.field = "prepared-mutation";
    preparedSections[0]!.text = "prepared-mutation";

    expect(mapped.tags).toEqual([]);
    expect(mapped.diagnostics[0]).not.toMatchObject({ field: "prepared-mutation" });
    expect(first.text).toBe("firstneedle");

    mapped.tags.push("native-mutation");
    mapped.diagnostics[0]!.message = "native-mutation";
    expect(second.text).toBe("secondneedle");
    expect(prepared.metadata.tags).toEqual(["prepared-mutation"]);
    expect(prepared.diagnostics[0]!.message).not.toBe("native-mutation");
  });

  it("maps a batch into detached native documents in caller order", () => {
    const first = prepare("type: z", "zneedle", "z.md");
    const second = prepare("type: a", "aneedle", "a.md");
    const inputs = [first, second];

    const mapped = mapPreparedDocuments(inputs);

    expect(mapped.map(({ documentId, path, type }) => ({ documentId, path, type })))
      .toEqual([
        { documentId: "z", path: "z.md", type: "z" },
        { documentId: "a", path: "a.md", type: "a" },
      ]);
    expect(mapped).not.toBe(inputs);
    expect(mapped[0]!.sections).not.toBe(mapped[1]!.sections);
  });

  it("rejects a fatal preparation value instead of producing a native DTO", () => {
    const fatal = {
      conformance: "fatal",
      diagnostics: [{
        code: "ERR_OKF_PARSE",
        message: "Cannot parse OKF concept: fatal.md",
        path: "fatal.md",
      }],
    } as unknown as PreparedOkfDocument;

    expect(() => mapPreparedDocument(fatal)).toThrowError(TypeError);
    expect(() => mapPreparedDocument(fatal)).toThrow(
      "Fatal OKF preparation results cannot be mapped to native DTOs",
    );
  });
});
