import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import { openOkf } from "../src/index.js";
import type {
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
    bundles.splice(0).map((bundle) =>
      bundle.cleanup()),
  );
});

async function open(
  files: Record<string, string>,
): Promise<OkfSearch> {
  const tree = await createBundle(files);
  bundles.push(tree);
  return openOkf(tree.root);
}

describe("search limits", () => {
  it("accepts zero and positive limits and defaults to ten", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 11 }, (_, index) => [
        `doc-${String(index).padStart(2, "0")}.md`,
        concept(`
          type: note
          title: Shared Limit Title
        `, "limitneedle shared body"),
      ]),
    );
    const okf = await open(files);

    expect(okf.search("limitneedle")).toHaveLength(10);
    expect(okf.search("limitneedle", {
      limit: 2,
    })).toHaveLength(2);
    expect(okf.search("limitneedle", {
      limit: 20,
    })).toHaveLength(11);
    expect(okf.search("limitneedle", {
      limit: 0,
    })).toEqual([]);
    expect(okf.search("", {
      limit: 0,
    })).toEqual([]);
  });

  it("rejects invalid runtime limits before a blank-query return", async () => {
    const okf = await open({
      "valid.md": concept(`
        type: note
        title: Limit Validation
      `, "limitneedle"),
    });
    const invalidLimits: unknown[] = [
      null,
      "1",
      true,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
      1.5,
    ];
    const expected = new TypeError(
      "options.limit must be a finite non-negative integer",
    );

    for (const limit of invalidLimits) {
      expect(() => okf.search("", {
        limit: limit as number,
      })).toThrowError(expected);
      expect(() => okf.search("limitneedle", {
        limit: limit as number,
      })).toThrowError(expected);
    }
  });

  it("keeps invalid asOf precedence when limit is also invalid", async () => {
    const okf = await open({
      "valid.md": concept(`
        type: note
        title: Validation Precedence
      `, "limitneedle"),
    });
    const invalidAsOf = new Date(Number.NaN);
    const expected = new TypeError(
      "options.asOf must be a valid Date",
    );

    expect(() => okf.search("", {
      asOf: invalidAsOf,
      limit: -1,
    })).toThrowError(expected);
    expect(() => okf.search("limitneedle", {
      asOf: invalidAsOf,
      limit: -1,
    })).toThrowError(expected);
  });
});

describe("search controls", () => {
  it("preserves default OR behavior and supports any/all matching", async () => {
    const okf = await open({
      "partial.md": concept(
        "type: note",
        "matchalpha",
      ),
      "full.md": concept(
        "type: note",
        "matchalpha matchbeta",
      ),
    });

    const omitted = okf.search(
      "matchalpha matchbeta",
    );
    const any = okf.search(
      "matchalpha matchbeta",
      { match: "any" },
    );

    expect(omitted).toEqual(any);
    expect(any.map((hit) => hit.documentId).sort()).toEqual([
      "full",
      "partial",
    ]);
    expect(okf.search("matchalpha matchbeta", {
      match: "all",
    }).map((hit) => hit.documentId)).toEqual([
      "full",
    ]);

    const crossField = await open({
      "cross-field.md": concept(
        `
          type: note
          title: allfieldtitlealpha
        `,
        "allfieldbodybeta",
      ),
    });

    expect(crossField.search(
      "allfieldtitlealpha allfieldbodybeta",
      { match: "all" },
    )).toHaveLength(1);
  });

  it("keeps all matching terms within one indexed section", async () => {
    const okf = await open({
      "split.md": concept(
        "type: note",
        "# First\nsectionalpha\n# Second\nsectionbeta",
      ),
      "together.md": concept(
        "type: note",
        "# Together\nsectionalpha sectionbeta",
      ),
    });

    expect(okf.search(
      "sectionalpha sectionbeta",
      { match: "all" },
    ).map((hit) => hit.documentId)).toEqual([
      "together",
    ]);
  });

  it("accepts every public field alias and translates matched fields", async () => {
    const okf = await open({
      "aliases.md": concept(
        `
          type: publictypealias
          title: publictitlealias
          resource: publicresourcealias
          description: publicdescriptionalias
          tags: [publictagsalias]
          sources:
            - resource: publicsourcesalias
        `,
        "# publicheadingalias\npublicbodyalias",
      ),
    });

    const cases: Array<[
      OkfSearchField,
      string,
    ]> = [
      ["resource", "publicresourcealias"],
      ["title", "publictitlealias"],
      ["heading", "publicheadingalias"],
      ["description", "publicdescriptionalias"],
      ["tags", "publictagsalias"],
      ["type", "publictypealias"],
      ["sources", "publicsourcesalias"],
      ["body", "publicbodyalias"],
    ];

    for (const [field, term] of cases) {
      expect(okf.search(term, { fields: [field] })).toEqual([
        expect.objectContaining({
          documentId: "aliases",
          matchedFields: [field],
        }),
      ]);
    }

    expect(okf.search(
      "publictitlealias publicheadingalias publicbodyalias",
      { fields: ["title", "heading", "body"] },
    )[0]!.matchedFields).toEqual([
      "title",
      "heading",
      "body",
    ]);
  });

  it("deduplicates fields without changing the caller input", async () => {
    const okf = await open({
      "duplicate.md": concept(
        "type: note",
        "duplicatebodyalias",
      ),
    });
    const fields: OkfSearchField[] = [
      "body",
      "body",
    ];

    const duplicate = okf.search(
      "duplicatebodyalias",
      { fields },
    );
    const single = okf.search(
      "duplicatebodyalias",
      { fields: ["body"] },
    );

    expect(fields).toEqual(["body", "body"]);
    expect(duplicate).toEqual(single);
    expect(duplicate[0]!.matchedFields).toEqual([
      "body",
    ]);
  });

  it("rejects invalid match and fields values", async () => {
    const okf = await open({
      "validation.md": concept(
        "type: note",
        "validationneedle",
      ),
    });
    const matchError = new TypeError(
      'options.match must be "any" or "all"',
    );
    const fieldsError = new TypeError(
      "options.fields must be a non-empty array",
    );
    const entriesError = new TypeError(
      "options.fields must contain only valid OkfSearchField values",
    );

    for (const match of [
      null,
      "sometimes",
      true,
      1,
    ]) {
      expect(() => okf.search("validationneedle", {
        match: match as OkfSearchOptions["match"],
      })).toThrowError(matchError);
    }

    for (const fields of [
      [],
      null,
      "body",
      {},
    ]) {
      expect(() => okf.search("validationneedle", {
        fields: fields as OkfSearchOptions["fields"],
      })).toThrowError(fieldsError);
    }

    for (const fields of [
      new Array(1),
      ["body", "headingPath"],
      ["unknown"],
      ["body", undefined],
    ]) {
      expect(() => okf.search("validationneedle", {
        fields: fields as OkfSearchOptions["fields"],
      })).toThrowError(entriesError);
    }
  });

  it("validates new options before blank and zero-limit returns", async () => {
    const okf = await open({
      "validation-order.md": concept(
        "type: note",
        "validationorderneedle",
      ),
    });
    const invalidOptions: Array<[
      OkfSearchOptions,
      TypeError,
    ]> = [
      [
        { match: "invalid" as OkfSearchOptions["match"] },
        new TypeError(
          'options.match must be "any" or "all"',
        ),
      ],
      [
        { fields: [] },
        new TypeError(
          "options.fields must be a non-empty array",
        ),
      ],
      [
        {
          fields: ["headingPath"] as unknown as OkfSearchOptions["fields"],
        },
        new TypeError(
          "options.fields must contain only valid OkfSearchField values",
        ),
      ],
    ];

    for (const [options, error] of invalidOptions) {
      expect(() => okf.search("", options))
        .toThrowError(error);
      expect(() => okf.search(
        "validationorderneedle",
        { ...options, limit: 0 },
      )).toThrowError(error);
    }
  });

  it("keeps filters, deduplication, and tie ordering with scoped fields", async () => {
    const body = "# First\nscopedtie\n# Second\nscopedtie";
    const okf = await open({
      "b.md": concept("type: note", body),
      "a.md": concept("type: note", body),
      "c.md": concept("type: recipe", body),
    });

    const hits = okf.search("scopedtie", {
      fields: ["body"],
      where: { types: ["note"] },
      limit: 10,
    });

    expect(hits.map((hit) => hit.sectionId)).toEqual([
      "a#first",
      "b#first",
    ]);
    expect(hits[0]!.score).toBe(hits[1]!.score);
    expect(hits.every((hit) =>
      hit.matchedFields.every((field) => field === "body"),
    )).toBe(true);
  });
});

describe("fuzzy search", () => {
  it("keeps one-edit typos opt-in", async () => {
    const okf = await open({
      "alpha.md": concept(
        "type: note",
        "alpha",
      ),
    });

    expect(okf.search("alphi")).toEqual([]);
    expect(okf.search("alphi", {
      fuzzy: false,
    })).toEqual([]);
    expect(okf.search("alphi", {
      fuzzy: true,
    })).toEqual([
      expect.objectContaining({
        documentId: "alpha",
      }),
    ]);
  });

  it("combines earlier fuzzy matching with final-term prefix matching", async () => {
    const okf = await open({
      "fuzzy-prefix.md": concept(`
        type: note
        title: Recovery guide
      `, "# Recovery\nrollback procedure"),
    });
    const query = "rollbak proce";

    expect(okf.search(query, {
      match: "all",
    })).toEqual([]);
    expect(okf.search(query, {
      match: "all",
      fuzzy: true,
    })).toEqual([
      expect.objectContaining({
        documentId: "fuzzy-prefix",
        sectionId: "fuzzy-prefix#recovery",
        matchedFields: ["body"],
      }),
    ]);
  });

  it("validates fuzzy after existing options and before empty results", async () => {
    const okf = await open({
      "validation.md": concept(
        "type: note",
        "fuzzyvalidation",
      ),
    });
    const fuzzyError = new TypeError(
      "options.fuzzy must be a boolean",
    );

    for (const fuzzy of [null, "true", 0, {}]) {
      const options = {
        fuzzy: fuzzy as unknown as OkfSearchOptions["fuzzy"],
      };

      expect(() => okf.search("", options))
        .toThrowError(fuzzyError);
      expect(() => okf.search("fuzzyvalidation", {
        ...options,
        limit: 0,
      })).toThrowError(fuzzyError);
    }

    const invalidFuzzy =
      "true" as unknown as OkfSearchOptions["fuzzy"];
    expect(() => okf.search("", {
      asOf: new Date(Number.NaN),
      fuzzy: invalidFuzzy,
    })).toThrowError(new TypeError(
      "options.asOf must be a valid Date",
    ));
    expect(() => okf.search("", {
      limit: -1,
      fuzzy: invalidFuzzy,
    })).toThrowError(new TypeError(
      "options.limit must be a finite non-negative integer",
    ));
    expect(() => okf.search("", {
      match: "invalid" as OkfSearchOptions["match"],
      fuzzy: invalidFuzzy,
    })).toThrowError(new TypeError(
      'options.match must be "any" or "all"',
    ));
    expect(() => okf.search("", {
      fields: [],
      fuzzy: invalidFuzzy,
    })).toThrowError(new TypeError(
      "options.fields must be a non-empty array",
    ));
    expect(() => okf.search("", {
      fields: ["not-a-field"] as unknown as OkfSearchOptions["fields"],
      fuzzy: invalidFuzzy,
    })).toThrowError(new TypeError(
      "options.fields must contain only valid OkfSearchField values",
    ));
  });
});

describe("search ordering", () => {
  it("orders exact score ties by record ID across opens and replacement", async () => {
    const markdown = concept(`
      type: note
      title: Exact Shared Title
      description: Exact shared description
      tags: [shared]
    `, "equaltieneedle exact shared body");
    const tree = await createBundle({
      "z.md": markdown,
      "a.md": markdown,
    });
    bundles.push(tree);

    const first = await openOkf(tree.root);
    const reopened = await openOkf(tree.root);
    const initialHits = first.search("equaltieneedle");
    const reopenedHits = reopened.search("equaltieneedle");

    first.ingest({
      path: "a.md",
      markdown,
    });
    const reindexedHits = first.search("equaltieneedle");

    for (const hits of [
      initialHits,
      reopenedHits,
      reindexedHits,
    ]) {
      expect(hits.map((hit) => hit.sectionId)).toEqual([
        "a#root",
        "z#root",
      ]);
      expect(hits[0]!.score).toBe(hits[1]!.score);
    }
  });
});

describe("search identity and metadata", () => {
  it("does not search directory or file document IDs", async () => {
    const okf = await open({
      "directoryidneedle/plain.md": concept(`
        type: note
        title: Explicit Directory Title
      `, "Explicit directory body"),
      "plain/fileidneedle.md": concept(`
        type: note
        title: Explicit File Title
      `, "Explicit file body"),
    });

    expect(okf.search("directoryidneedle")).toEqual([]);
    expect(okf.search("fileidneedle")).toEqual([]);
  });

  it("does not favor a document ID match over identical topical text", async () => {
    const okf = await open({
      "topicalneedle/with-id.md": concept(`
        type: note
        title: Shared Topic
      `, "Shared topicalneedle body"),
      "plain/without-id.md": concept(`
        type: note
        title: Shared Topic
      `, "Shared topicalneedle body"),
    });

    const hits = okf.search("topicalneedle", {
      limit: 10,
    });
    const withDocumentId = hits.find((hit) =>
      hit.documentId === "topicalneedle/with-id");
    const withoutDocumentId = hits.find((hit) =>
      hit.documentId === "plain/without-id");

    expect(hits).toHaveLength(2);
    expect(withDocumentId).toBeDefined();
    expect(withoutDocumentId).toBeDefined();
    expect(withDocumentId!.score).toBe(
      withoutDocumentId!.score,
    );
    expect(withDocumentId!.matchedFields).toEqual(
      withoutDocumentId!.matchedFields,
    );
    expect(withDocumentId!.matchedFields).not.toContain(
      "documentId",
    );
  });

  it("returns document IDs and replaces records by logical identity", async () => {
    const okf = await open({});

    const added = okf.ingest({
      path: "identity/guide.md",
      markdown: concept(`
        type: note
        title: Stable Guide
      `, "oldtopicneedle"),
    });

    expect(added.records).toEqual([
      expect.objectContaining({
        documentId: "identity/guide",
        path: "identity/guide.md",
      }),
    ]);
    expect(okf.search("oldtopicneedle")).toEqual([
      expect.objectContaining({
        documentId: "identity/guide",
        path: "identity/guide.md",
      }),
    ]);

    const replacement = okf.ingest({
      path: "./identity//guide.md",
      markdown: concept(`
        type: changed
        title: Stable Guide
      `, "newtopicneedle"),
    });

    expect(replacement.document.id).toBe("identity/guide");
    expect(okf.search("oldtopicneedle")).toEqual([]);
    expect(okf.search("newtopicneedle")).toEqual([
      expect.objectContaining({
        documentId: "identity/guide",
        path: "identity/guide.md",
      }),
    ]);
  });

  it("filters by frontmatter type independently of document path", async () => {
    const okf = await open({
      "first/reference.md": concept(`
        type: note
        title: Reference Topic
      `, "Shared typefilterneedle body"),
      "second/guide.md": concept(`
        type: recipe
        title: Guide Topic
      `, "Shared typefilterneedle body"),
    });

    expect(okf.search("typefilterneedle", {
      limit: 10,
    }).map((hit) => hit.path).sort()).toEqual([
      "first/reference.md",
      "second/guide.md",
    ]);
    expect(okf.search("typefilterneedle", {
      where: { types: ["note"] },
    })).toEqual([
      expect.objectContaining({
        documentId: "first/reference",
        path: "first/reference.md",
      }),
    ]);
    expect(okf.search("typefilterneedle", {
      where: { types: ["recipe"] },
    })).toEqual([
      expect.objectContaining({
        documentId: "second/guide",
        path: "second/guide.md",
      }),
    ]);
  });
});
