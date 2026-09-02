import { describe, expect, it } from "vitest";

import {
  createOkfSearch,
  validateOkfDocument,
} from "../src/index.js";
import type { OkfSearchOptions } from "../src/index.js";

function concept(metadata: string, body = "body"): string {
  return `---\n${metadata.trim()}\n---\n${body}\n`;
}

describe("validateOkfDocument", () => {
  it("returns strict, degraded, and fatal results without throwing", () => {
    expect(validateOkfDocument({
      path: "strict.md",
      markdown: concept("type: note"),
    })).toEqual({ isValid: true, isIndexable: true, errors: [] });

    expect(validateOkfDocument({
      path: "degraded.md",
      markdown: concept("type: note\nstatus: future"),
    })).toEqual({
      isValid: false,
      isIndexable: true,
      errors: [expect.objectContaining({
        code: "ERR_OKF_FIELD",
        path: "degraded.md",
        field: "status",
      })],
    });

    expect(() => validateOkfDocument({
      path: "../unsafe.md",
      markdown: "not frontmatter",
    })).not.toThrow();
    expect(validateOkfDocument({
      path: "../unsafe.md",
      markdown: "not frontmatter",
    })).toEqual({
      isValid: false,
      isIndexable: false,
      errors: [expect.objectContaining({
        code: "ERR_OKF_FIELD",
        path: "<input>",
        field: "path",
      })],
    });
  });

  it("returns fresh detached diagnostics", () => {
    const input = {
      path: "degraded.md",
      markdown: concept("type: note\nstatus: future"),
    };
    const first = validateOkfDocument(input);
    const second = validateOkfDocument(input);

    expect(first).not.toBe(second);
    expect(first.errors).not.toBe(second.errors);
    first.errors[0]!.message = "caller mutation";
    expect(second.errors[0]!.message).toBe(
      "Invalid OKF field: degraded.md (status)",
    );
  });
});

describe("friendly search behavior", () => {
  it("supports any/all, field selection, final-term prefix, and fuzzy matching", () => {
    const index = createOkfSearch([
      {
        path: "full.md",
        markdown: concept(
          "type: note\ntitle: titleonlyneedle recovery",
          "matchalpha matchbeta rollback procedure",
        ),
      },
      {
        path: "partial.md",
        markdown: concept("type: note", "matchalpha"),
      },
    ]);

    expect(index.search("matchalpha matchbeta", { match: "any" })
      .map((hit) => hit.documentId).sort()).toEqual(["full", "partial"]);
    expect(index.search("matchalpha matchbeta", { match: "all" })
      .map((hit) => hit.documentId)).toEqual(["full"]);
    expect(index.search("titleonlyneedle", { fields: ["body"] })).toEqual([]);
    expect(index.search("titleonlyneedle", { fields: ["title"] }))
      .toHaveLength(1);
    expect(index.search("rollback proce", { match: "all", fields: ["body"] }))
      .toHaveLength(1);
    expect(index.search("rollbak", { fields: ["body"] })).toEqual([]);
    expect(index.search("rollbak", { fields: ["body"], fuzzy: 0.2 }))
      .toHaveLength(1);
  });

  it("supports boosts without asserting cross-engine score parity", () => {
    const term = "boostneedle";
    const index = createOkfSearch([
      {
        path: "title.md",
        markdown: concept(`type: note\ntitle: ${term}`, "control filler"),
      },
      {
        path: "body.md",
        markdown: concept("type: note\ntitle: control filler", term),
      },
    ]);

    expect(index.search(term, {
      fields: ["title", "body"],
      boost: { body: 10, title: 0.1 },
    })[0]?.documentId).toBe("body");
    expect(index.search(term, {
      fields: ["title", "body"],
      boost: { body: 0.1, title: 10 },
    })[0]?.documentId).toBe("title");
  });

  it("filters before limit across metadata, staleness, and conformance", () => {
    const at = new Date("2026-08-24T12:00:00Z");
    const index = createOkfSearch([
      {
        path: "degraded.md",
        markdown: concept(
          "type: note\ntitle: filterneedle\ntags: [target]\nstatus: stable\ndescription: {broken: true}\nverified:\n  by: human:alice\n  at: 2026-08-24T10:00:00Z\nstale_after: 2026-08-24T13:00:00Z",
          "first",
        ),
      },
      {
        path: "strict.md",
        markdown: concept(
          "type: recipe\ntitle: ordinary\ntags: [target]\nstatus: draft\nverified:\n  by: process:builder\n  at: 2026-08-24T10:00:00Z\nstale_after: 2026-08-24T11:00:00Z",
          "filterneedle",
        ),
      },
    ]);

    expect(index.search("filterneedle", {
      limit: 1,
      asOf: at,
      where: {
        types: ["recipe"],
        tagsAny: ["target"],
        statuses: ["draft"],
        trustTiers: ["machine-confirmed"],
        stale: true,
        conformance: ["strict"],
      },
    })).toEqual([
      expect.objectContaining({ documentId: "strict", conformance: "strict" }),
    ]);
    expect(index.search("filterneedle", {
      where: { conformance: ["degraded"] },
    })).toEqual([
      expect.objectContaining({ documentId: "degraded", conformance: "degraded" }),
    ]);
  });

  it("collapses sections to one document and returns detached result envelopes", () => {
    const index = createOkfSearch([{
      path: "sections.md",
      markdown: concept(
        "type: note\ntitle: collapseenvelope",
        "# First\ncollapseenvelope\n\n# Second\ncollapseenvelope",
      ),
    }]);

    const first = index.search("collapseenvelope", { limit: 10 });
    expect(first).toHaveLength(1);
    expect(Object.keys(first[0]!).sort()).toEqual([
      "conformance",
      "documentId",
      "endLine",
      "headingPath",
      "matchedFields",
      "path",
      "score",
      "sectionId",
      "snippet",
      "startLine",
      "title",
    ]);
    expect(first[0]).toMatchObject({
      documentId: "sections",
      path: "sections.md",
      conformance: "strict",
      matchedFields: expect.any(Array),
      startLine: expect.any(Number),
      endLine: expect.any(Number),
      snippet: expect.any(String),
    });

    first[0]!.matchedFields.push("body");
    first[0]!.title = "caller mutation";
    const second = index.search("collapseenvelope", { limit: 10 });
    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]!.matchedFields).not.toBe(first[0]!.matchedFields);
    expect(second[0]!.title).not.toBe("caller mutation");
  });

  it("sanitizes to fresh options, ignores top-level extras, and never mutates input", () => {
    const index = createOkfSearch([{
      path: "options.md",
      markdown: concept("type: note\ntags: [kept]", "optionsneedle"),
    }]);
    const where = { types: ["note"], tagsAny: ["kept"] };
    const fields = ["body"] as const;
    const boost = { body: 2 };
    const asOf = new Date("2026-08-24T12:00:00Z");
    const options = {
      where,
      fields,
      boost,
      asOf,
      unknown: "ignored",
    } as OkfSearchOptions & { unknown: string };
    const before = {
      where: { types: [...where.types], tagsAny: [...where.tagsAny] },
      fields: [...fields],
      boost: { ...boost },
      time: asOf.getTime(),
    };

    expect(index.search("optionsneedle", options)).toHaveLength(1);
    expect(where).toEqual(before.where);
    expect(fields).toEqual(before.fields);
    expect(boost).toEqual(before.boost);
    expect(asOf.getTime()).toBe(before.time);
  });

  it("validates known options before blank and zero-limit exits", () => {
    const index = createOkfSearch([]);
    const invalid = { where: { stale: "no" } } as unknown as OkfSearchOptions;

    expect(() => index.search("", invalid)).toThrowError(
      new TypeError("options.where.stale must be a boolean"),
    );
    expect(() => index.search("anything", {
      ...invalid,
      limit: 0,
    })).toThrowError(new TypeError("options.where.stale must be a boolean"));
    expect(index.search("", { limit: 0, unknown: true } as OkfSearchOptions))
      .toEqual([]);
  });
});
