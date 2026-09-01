import { describe, expect, it } from "vitest";

import { prepareOkfDocument } from "../src/index.js";

function concept(metadata: string, body = "body"): string {
  const lines = metadata.split("\n");
  while (!lines[0]?.trim()) lines.shift();
  while (!lines.at(-1)?.trim()) lines.pop();
  const indentation = Math.min(...lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0));
  return `---\n${lines.map((line) => line.slice(indentation)).join("\n")}\n---\n${body}`;
}

function prepare(metadata: string, body = "body", path = "concept.md") {
  return prepareOkfDocument({ path, markdown: concept(metadata, body) });
}

describe("prepared metadata and facets", () => {
  it("salvages searchable values and keeps malformed-present facets unclassified", () => {
    const result = prepare(`
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
    `, "mixedbodyneedle", "./nested//derived-title.md");

    expect(result.conformance).toBe("degraded");
    if (result.conformance !== "degraded") expect.unreachable();
    expect(result.identity).toEqual({
      path: "nested/derived-title.md",
      documentId: "nested/derived-title",
    });
    expect(result.metadata).toEqual({
      title: "",
      description: "validdescriptionsalvage",
      tags: ["validtagsalvage"],
      sourceText: [
        "validsourceidsalvage",
        "validsourcetitlesalvage",
        "producerauthor/version",
        "validsourceresourcesalvage",
      ].join(" "),
    });
    expect(result.facets).toEqual({
      status: { classified: false },
      trust: { classified: true, value: "human-reviewed" },
      staleness: { classified: false },
    });
    expect(result.diagnostics.map((error) => error.field)).toEqual([
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
    ]);
  });

  it("distinguishes absent defaults, invalid-only facets, and valid evidence", () => {
    const absent = prepare("type: note\ndescription: 1");
    expect(absent.facets).toEqual({
      status: { classified: true, value: "stable" },
      trust: { classified: true, value: "unverified" },
      staleness: { classified: true },
    });

    const invalid = prepare(`
      type: note
      verified:
        - by: invalid actor
          at: never
      status: future
      stale_after: yesterday
    `);
    expect(invalid.facets).toEqual({
      status: { classified: false },
      trust: { classified: false },
      staleness: { classified: false },
    });

    const valid = prepare(`
      type: note
      verified:
        - by: process:builder
          at: 2026-08-24T10:00:00Z
        - by: human:alice
          at: 2026-08-24T10:00:00Z
      status: deprecated
      stale_after: 2026-08-24T11:00:00.1239+01:00
    `);
    expect(valid.facets).toEqual({
      status: { classified: true, value: "deprecated" },
      trust: { classified: true, value: "human-reviewed" },
      staleness: {
        classified: true,
        staleAfter: "2026-08-24T11:00:00.1239+01:00",
        staleAfterEpoch: Date.parse("2026-08-24T10:00:00.124Z"),
      },
    });
  });
});

describe("prepared sections", () => {
  it("emits an empty root section", () => {
    expect(prepare("type: note", "", "nested/empty.md").sections).toEqual([{
      id: "nested/empty#root",
      headingPath: "Empty",
      text: "",
      startLine: 4,
      endLine: 4,
    }]);
  });

  it.each(["\n", "\r\n"])("projects nested headings and %j line endings", (newline) => {
    const markdown = concept(
      "type: note",
      "# Parent\n\n## Child\nlineendingneedle",
    ).replaceAll("\n", newline);
    const result = prepareOkfDocument({ path: "nested.md", markdown });

    expect(result.sections).toEqual([
      {
        id: "nested#parent",
        headingPath: "Parent",
        text: "",
        startLine: 4,
        endLine: 4,
      },
      {
        id: "nested#parent-child",
        headingPath: "Parent > Child",
        text: "lineendingneedle",
        startLine: 6,
        endLine: 7,
      },
    ]);
  });

  it("uses document-wide normalized slug collisions and untitled fallback", () => {
    const result = prepare("type: note", [
      "# Café!",
      "first",
      "# Cafe",
      "second",
      "#",
      "third",
      "#",
      "fourth",
    ].join("\n"), "slugs.md");

    expect(result.sections.map(({ id, headingPath, text }) => ({ id, headingPath, text })))
      .toEqual([
        { id: "slugs#cafe", headingPath: "Café!", text: "first" },
        { id: "slugs#cafe--2", headingPath: "Cafe", text: "second" },
        { id: "slugs#untitled-section", headingPath: "Untitled section", text: "third" },
        { id: "slugs#untitled-section--2", headingPath: "Untitled section", text: "fourth" },
      ]);
  });

  it("keeps 800 words whole and splits 801 words by complete blocks", () => {
    const paragraph = (words: number) => Array.from({ length: words }, () => "word").join(" ");
    const atLimit = prepare("type: note", Array.from({ length: 8 }, () => paragraph(100)).join("\n\n"), "limit.md");
    const overLimit = prepare("type: note", [
      ...Array.from({ length: 7 }, () => paragraph(100)),
      paragraph(101),
    ].join("\n\n"), "over.md");

    expect(atLimit.sections).toHaveLength(1);
    expect(atLimit.sections[0]!.id).toBe("limit#root");
    expect(overLimit.sections.map((section) => section.id)).toEqual([
      "over#root--part-1",
      "over#root--part-2",
    ]);
  });

  it("groups around 500 words and merges a final group below 250", () => {
    const terms = [
      "alpha", "bravo", "charlie", "delta", "echo",
      "foxtrot", "golf", "hotel", "india", "juliet",
    ];
    const paragraphs = terms.map((term) => `${term} ${"filler ".repeat(100).trim()}`);
    const result = prepare("type: sections", `# Chunks\n${paragraphs.join("\n\n")}`, "sections.md");

    expect(result.sections).toEqual([
      {
        id: "sections#chunks--part-1",
        headingPath: "Chunks",
        text: paragraphs.slice(0, 4).join("\n\n"),
        startLine: 4,
        endLine: 11,
      },
      {
        id: "sections#chunks--part-2",
        headingPath: "Chunks",
        text: paragraphs.slice(4).join("\n\n"),
        startLine: 13,
        endLine: 23,
      },
    ]);
  });
});
