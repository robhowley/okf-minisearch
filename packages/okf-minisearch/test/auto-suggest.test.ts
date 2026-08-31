import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createOkfSearch,
  openOkf,
} from "../src/index.js";
import { openOkf as openBrowserOkf } from "../src/browser.js";
import type {
  OkfAutoSuggestOptions,
  OkfSearch,
  OkfSearchField,
  OkfSearchOptions,
} from "../src/index.js";
import {
  concept,
  createBundle,
  type TestBundle,
} from "./support/bundle.js";

const bundles: TestBundle[] = [];

afterEach(async () => {
  await Promise.all(
    bundles.splice(0).map((bundle) => bundle.cleanup()),
  );
});

async function open(
  files: Record<string, string>,
): Promise<OkfSearch> {
  const tree = await createBundle(files);
  bundles.push(tree);
  return openOkf(tree.root);
}

function suggestions(
  okf: OkfSearch,
  query: string,
  options?: OkfAutoSuggestOptions,
): string[] {
  return okf.autoSuggest(query, options).map((item) => item.suggestion);
}

describe("autoSuggest matching and fields", () => {
  it("uses native AND matching and expands one- and two-character final prefixes", async () => {
    const okf = await open({
      "alpha-beta.md": concept("type: note", "alpha beta"),
      "alpha-gamma.md": concept("type: note", "alpha gamma"),
    });

    expect(suggestions(okf, "alpha b")).toEqual(["alpha beta"]);
    expect(suggestions(okf, "alpha be")).toEqual(["alpha beta"]);
    expect(suggestions(okf, "alpha z")).toEqual([]);
    expect(suggestions(okf, "alpha z", { match: "any" })).toContain("alpha");
  });

  it("searches all fields by default and honors public field aliases", async () => {
    const okf = await open({
      "aliases.md": concept(`
        type: typealias
        resource: resourcealias
        title: titlealias
        description: descriptionalias
        tags: [tagsalias]
        sources:
          - resource: sourcesalias
      `, "# headingalias\nbodyalias"),
    });

    const fields = [
      "resourcealias",
      "titlealias",
      "headingalias",
      "descriptionalias",
      "tagsalias",
      "typealias",
      "sourcesalias",
      "bodyalias",
    ];

    for (const term of fields) {
      expect(suggestions(okf, term)).toContain(term);
    }

    const aliases: Array<[OkfSearchField, string]> = [
      ["heading", "headingalias"],
      ["sources", "sourcesalias"],
      ["body", "bodyalias"],
    ];
    for (const [field, term] of aliases) {
      expect(suggestions(okf, term, { fields: [field] })).toEqual([term]);
    }

    expect(suggestions(okf, "titlealias", { fields: ["body"] })).toEqual([]);
  });
});

describe("autoSuggest boosts and fuzzy matching", () => {
  it("keeps omitted, empty, and neutral boosts equivalent, then allows ordering changes", async () => {
    const term = "boostsuggestionneedle";
    const okf = await open({
      "title.md": concept(`type: note\ntitle: ${term}alpha`, "title filler"),
      "body.md": concept("type: note", `${term}beta`),
    });

    const baseline = okf.autoSuggest(term, { fields: ["title", "body"] });
    expect(baseline.map((item) => item.suggestion)).toEqual(
      expect.arrayContaining([
        `${term}alpha`,
        `${term}beta`,
      ]),
    );
    expect(baseline).toHaveLength(2);
    expect(okf.autoSuggest(term, { fields: ["title", "body"], boost: {} })).toEqual(baseline);
    expect(okf.autoSuggest(term, {
      fields: ["title", "body"],
      boost: { title: 1 },
    })).toEqual(baseline);

    const titleFirst = okf.autoSuggest(term, {
      fields: ["title", "body"],
      boost: { title: 10 },
    });
    const bodyFirst = okf.autoSuggest(term, {
      fields: ["title", "body"],
      boost: { body: 10 },
    });
    expect(titleFirst[0]!.suggestion).toBe(`${term}alpha`);
    expect(bodyFirst[0]!.suggestion).toBe(`${term}beta`);
    expect(titleFirst[0]!.score).toBeGreaterThan(titleFirst[1]!.score);
    expect(bodyFirst[0]!.score).toBeGreaterThan(bodyFirst[1]!.score);
  });

  it("keeps fuzzy matching opt-in and supports true, zero, and a bounded numeric threshold", async () => {
    const okf = await open({
      "alpha.md": concept("type: note", "alpha"),
    });

    expect(suggestions(okf, "alphi")).toEqual([]);
    expect(suggestions(okf, "alphi", { fuzzy: 0 })).toEqual([]);
    expect(suggestions(okf, "alphi", { fuzzy: true })).toEqual(["alpha"]);
    expect(suggestions(okf, "alphi", { fuzzy: 0.2 })).toEqual(["alpha"]);
  });
});

describe("autoSuggest filters and validation", () => {
  it("combines facets and asOf, while empty filter arrays are ignored", async () => {
    const okf = await open({
      "target.md": concept(`
        type: note
        tags: [target]
        status: stable
        stale_after: 2026-08-24T13:00:00Z
        verified:
          - by: human:alice
            at: 2026-08-24T10:00:00Z
      `, "filterautosuggest finishtarget"),
      "wrong-type.md": concept(`
        type: recipe
        tags: [target]
        status: stable
        stale_after: 2026-08-24T13:00:00Z
        verified:
          - by: human:alice
            at: 2026-08-24T10:00:00Z
      `, "filterautosuggest finishwrongtype"),
      "wrong-tag.md": concept(`
        type: note
        tags: [other]
        status: stable
        stale_after: 2026-08-24T13:00:00Z
        verified:
          - by: human:alice
            at: 2026-08-24T10:00:00Z
      `, "filterautosuggest finishwrongtag"),
      "wrong-status.md": concept(`
        type: note
        tags: [target]
        status: draft
        stale_after: 2026-08-24T13:00:00Z
        verified:
          - by: human:alice
            at: 2026-08-24T10:00:00Z
      `, "filterautosuggest finishwrongstatus"),
      "wrong-trust.md": concept(`
        type: note
        tags: [target]
        status: stable
        stale_after: 2026-08-24T13:00:00Z
        verified:
          - by: process:auto-suggest
            at: 2026-08-24T10:00:00Z
      `, "filterautosuggest finishwrongtrust"),
      "stale.md": concept(`
        type: note
        tags: [target]
        status: stable
        stale_after: 2026-08-24T11:00:00Z
        verified:
          - by: human:alice
            at: 2026-08-24T10:00:00Z
      `, "filterautosuggest finishstale"),
      "degraded.md": concept(`
        type: note
        tags: [target]
        status: stable
        stale_after: 2026-08-24T13:00:00Z
        verified:
          - by: human:alice
            at: 2026-08-24T10:00:00Z
        description: 42
      `, "filterautosuggest finishwrongconformance"),
    });
    const asOf = new Date("2026-08-24T12:00:00Z");
    const allSuggestions = suggestions(okf, "filterautosuggest finish");
    const filtered = suggestions(okf, "filterautosuggest finish", {
      asOf,
      where: {
        types: ["note"],
        tagsAny: ["target"],
        statuses: ["stable"],
        trustTiers: ["human-reviewed"],
        stale: false,
        conformance: ["strict"],
      },
    });

    expect(allSuggestions).toEqual(expect.arrayContaining([
      "filterautosuggest finishtarget",
      "filterautosuggest finishwrongtype",
      "filterautosuggest finishwrongtag",
      "filterautosuggest finishwrongstatus",
      "filterautosuggest finishwrongtrust",
      "filterautosuggest finishstale",
      "filterautosuggest finishwrongconformance",
    ]));
    expect(filtered).toEqual(["filterautosuggest finishtarget"]);

    const all = okf.autoSuggest("filterautosuggest");
    expect(okf.autoSuggest("filterautosuggest", {
      where: {
        types: [],
        tagsAny: [],
        statuses: [],
        trustTiers: [],
        conformance: [],
      },
    })).toEqual(all);
  });

  it("uses exact validation messages and validates before blank and zero-limit returns", async () => {
    const okf = await open({
      "validation.md": concept("type: note", "autosuggestvalidation"),
    });
    const cases: Array<[OkfAutoSuggestOptions, string]> = [
      [{ asOf: new Date(Number.NaN) }, "options.asOf must be a valid Date"],
      [{ asOf: null as unknown as Date }, "options.asOf must be a valid Date"],
      [{ limit: -1 }, "options.limit must be a finite non-negative integer"],
      [{ match: "invalid" as OkfAutoSuggestOptions["match"] }, 'options.match must be "any" or "all"'],
      [{ fields: [] }, "options.fields must be a non-empty array"],
      [{ fields: ["headingPath"] as unknown as OkfAutoSuggestOptions["fields"] }, "options.fields must contain only valid OkfSearchField values"],
      [{ fuzzy: "true" as unknown as OkfAutoSuggestOptions["fuzzy"] }, "options.fuzzy must be a boolean or a finite number between 0 and 1, inclusive"],
      [{ where: null as unknown as OkfAutoSuggestOptions["where"] }, "options.where must be an object"],
      [{ where: { unknown: true } as unknown as OkfAutoSuggestOptions["where"] }, "options.where must contain only valid filter names"],
      [{ boost: null as unknown as OkfAutoSuggestOptions["boost"] }, "options.boost must be an object"],
      [{ boost: { unknown: 1 } as unknown as OkfAutoSuggestOptions["boost"] }, "options.boost must contain only valid OkfSearchField keys"],
      [{ boost: { title: 0 } }, "options.boost.title must be a finite number between 0.1 and 10, inclusive"],
    ];

    for (const [options, message] of cases) {
      const error = new TypeError(message);
      expect(() => okf.autoSuggest("", options)).toThrowError(error);
      if (options.limit !== -1) {
        expect(() => okf.autoSuggest("autosuggestvalidation", {
          ...options,
          limit: 0,
        })).toThrowError(error);
      }
    }

    expect(() => okf.autoSuggest("", {
      asOf: new Date(Number.NaN),
      limit: -1,
    })).toThrowError(new TypeError("options.asOf must be a valid Date"));
    expect(() => okf.autoSuggest("", {
      limit: -1,
      match: "invalid" as OkfAutoSuggestOptions["match"],
    })).toThrowError(new TypeError(
      "options.limit must be a finite non-negative integer",
    ));
  });
});

describe("autoSuggest grouping and lifecycle", () => {
  it("returns equivalent suggestions through direct, Node, and browser construction", async () => {
    const markdown = concept("type: note", "threepathsuggestionneedle");
    const tree = await createBundle({ "parity.md": markdown });
    bundles.push(tree);
    const file = {
      name: "parity.md",
      webkitRelativePath: "",
      arrayBuffer: async () => new TextEncoder().encode(markdown).buffer,
    } as File;
    const handles = [
      createOkfSearch([{ path: "parity.md", markdown }]),
      await openOkf(tree.root),
      await openBrowserOkf([file]),
    ];

    expect(handles.map((okf) => okf.autoSuggest(
      "threepathsuggestion",
    ))).toEqual([
      handles[0]!.autoSuggest("threepathsuggestion"),
      handles[0]!.autoSuggest("threepathsuggestion"),
      handles[0]!.autoSuggest("threepathsuggestion"),
    ]);
  });

  it("groups phrases across sections and records, filters before grouping, orders by score, and limits after grouping", async () => {
    const repeated = "# First\ntopic alpha\n# Second\ntopic alpha";
    const okf = await open({
      "one.md": concept("type: note", repeated),
      "two.md": concept("type: note", "# Only\ntopic alpha"),
      "three.md": concept("type: note", "# Only\ntopic alpine"),
      "four.md": concept("type: recipe", "# Only\ntopic albatross"),
      "five.md": concept("type: recipe", "# Only\ntopic alpha"),
    });

    const unrestricted = okf.autoSuggest("topic a", { limit: 20 });
    const phrases = unrestricted.map((item) => item.suggestion);
    expect(phrases.filter((phrase) => phrase.startsWith("topic alpha"))).toHaveLength(1);
    expect(phrases.some((phrase) => phrase.startsWith("topic alpine"))).toBe(true);
    expect(phrases.some((phrase) => phrase.startsWith("topic albatross"))).toBe(true);
    expect(unrestricted.every((item) => item.score > 0 && Number.isFinite(item.score))).toBe(true);
    expect(unrestricted.every((item, index, items) =>
      index === 0 || items[index - 1]!.score >= item.score,
    )).toBe(true);

    const filtered = okf.autoSuggest("topic a", {
      where: { types: ["note"] },
      limit: 20,
    });
    expect(filtered.map((item) => item.suggestion)).not.toContain("topic albatross");
    expect(filtered.map((item) => item.suggestion)).toContain("topic alpha");

    expect(okf.autoSuggest("topic a", {
      where: { types: ["note"] },
      limit: 2,
    })).toEqual(filtered.slice(0, 2));
  });

  it("uses every filtered record in the same-phrase score", async () => {
    const phrase = "topic alpha";
    const okf = await open({
      "note-sections.md": concept(
        "type: note",
        `# First\n${phrase}\n# Second\n${phrase}`,
      ),
      "note-root.md": concept("type: note", phrase),
      "recipe.md": concept(
        "type: recipe",
        `${phrase} ${"filler ".repeat(40)}`,
      ),
    });

    const noteAlpha = okf.autoSuggest("topic a", {
      fields: ["body"],
      where: { types: ["note"] },
    }).find((item) => item.suggestion === phrase);
    const recipeAlpha = okf.autoSuggest("topic a", {
      fields: ["body"],
      where: { types: ["recipe"] },
    }).find((item) => item.suggestion === phrase);
    const unrestrictedAlpha = okf.autoSuggest("topic a", {
      fields: ["body"],
    }).find((item) => item.suggestion === phrase);
    expect(noteAlpha).toBeDefined();
    expect(recipeAlpha).toBeDefined();
    expect(unrestrictedAlpha).toBeDefined();
    expect(noteAlpha!.score).not.toBeCloseTo(recipeAlpha!.score, 5);

    const noteRecordCount = 3;
    const recipeRecordCount = 1;
    const recordWeightedMean = (
      noteAlpha!.score * noteRecordCount +
      recipeAlpha!.score * recipeRecordCount
    ) / (noteRecordCount + recipeRecordCount);
    expect(noteRecordCount).not.toBe(recipeRecordCount);
    expect(unrestrictedAlpha!.score).toBeCloseTo(recordWeightedMean, 10);

    expect(recordWeightedMean).not.toBeCloseTo(noteAlpha!.score, 5);
    expect(recordWeightedMean).not.toBeCloseTo(recipeAlpha!.score, 5);

    const noteDocumentCount = 2;
    const recipeDocumentCount = 1;
    const documentWeightedMean = (
      noteAlpha!.score * noteDocumentCount +
      recipeAlpha!.score * recipeDocumentCount
    ) / (noteDocumentCount + recipeDocumentCount);
    expect(recordWeightedMean).not.toBeCloseTo(documentWeightedMean, 5);
  });

  it("keeps blank and punctuation-only input empty, detaches results, and exposes no record metadata", async () => {
    const okf = await open({
      "ownership.md": concept("type: note\ntitle: Private title", "ownershipneedle"),
    });

    expect(okf.autoSuggest("   ")).toEqual([]);
    expect(okf.autoSuggest("!!! ???")).toEqual([]);

    const first = okf.autoSuggest("ownershipneedle");
    expect(first).toHaveLength(1);
    expect(Object.keys(first[0]!).sort()).toEqual(["score", "suggestion", "terms"]);
    const terms = first[0]!.terms as string[];
    terms.push("caller-mutated");
    (first[0] as { suggestion: string }).suggestion = "caller-mutated";

    expect(okf.autoSuggest("ownershipneedle")).toEqual([
      {
        suggestion: "ownershipneedle",
        terms: ["ownershipneedle"],
        score: expect.any(Number),
      },
    ]);
  });

  it("keeps startup, ingest, replacement, and removal visible through one handle", async () => {
    const okf = await open({
      "startup.md": concept("type: note", "startupautosuggest"),
    });
    expect(suggestions(okf, "startupautosuggest")).toEqual(["startupautosuggest"]);

    okf.ingest({
      path: "live.md",
      markdown: concept("type: note", "liveautosuggest"),
    });
    expect(suggestions(okf, "liveautosuggest")).toEqual(["liveautosuggest"]);

    okf.ingest({
      path: "live.md",
      markdown: concept("type: note", "replacementautosuggest"),
    });
    expect(suggestions(okf, "liveautosuggest")).toEqual([]);
    expect(suggestions(okf, "replacementautosuggest")).toEqual(["replacementautosuggest"]);

    expect(okf.remove("live.md")).toBe(true);
    expect(suggestions(okf, "replacementautosuggest")).toEqual([]);
  });
});
