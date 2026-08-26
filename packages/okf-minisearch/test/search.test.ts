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

function boostOptions(
  boost: unknown,
  options: OkfSearchOptions = {},
): OkfSearchOptions {
  return Object.assign({}, options, {
    boost,
  }) as OkfSearchOptions;
}

function fieldDocument(
  field: OkfSearchField,
  term: string,
): string {
  const metadata = ["type: note"];
  let body = "field control filler";

  switch (field) {
    case "resource":
      metadata.push(`resource: ${term}`);
      break;
    case "title":
      metadata.push(`title: ${term}`);
      break;
    case "heading":
      body = `# ${term}\nfield control filler`;
      break;
    case "description":
      metadata.push(`description: ${term}`);
      break;
    case "tags":
      metadata.push(`tags: [${term}]`);
      break;
    case "type":
      metadata[0] = `type: ${term}`;
      break;
    case "sources":
      metadata.push(
        "sources:",
        `  - resource: ${term}`,
      );
      break;
    case "body":
      body = term;
      break;
  }

  return concept(metadata.join("\n"), body);
}

function titleBodyFiles(
  term: string,
): Record<string, string> {
  return {
    "title.md": fieldDocument("title", term),
    "body.md": fieldDocument("body", term),
  };
}

function resultFields(
  okf: OkfSearch,
  term: string,
  options?: OkfSearchOptions,
) {
  return okf.search(term, options).map((hit) => ({
    documentId: hit.documentId,
    matchedFields: hit.matchedFields,
  }));
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

describe("search boosts", () => {
  it("preserves omitted and baseline boosts", async () => {
    const term = "neutralboostneedle";
    const okf = await open({
      "all-fields.md": concept(`
        type: ${term}
        resource: ${term}
        title: ${term}
        description: ${term}
        tags: [${term}]
        sources:
          - resource: ${term}
      `, `# ${term}\n${term}`),
    });
    const baseline = okf.search(term);
    const omissionCases: Array<OkfSearchOptions | undefined> = [
      undefined,
      {},
      boostOptions(undefined),
      boostOptions({}),
    ];

    for (const options of omissionCases) {
      expect(okf.search(term, options)).toEqual(baseline);
    }

    const baselineBoosts: Record<OkfSearchField, number> = {
      resource: 6,
      title: 5,
      heading: 4,
      description: 3,
      tags: 2,
      type: 1.5,
      sources: 1,
      body: 1,
    };

    for (const [field, boost] of Object.entries(baselineBoosts) as Array<[
      OkfSearchField,
      number,
    ]>) {
      expect(okf.search(term, boostOptions({
        [field]: boost,
      }))).toEqual(baseline);
    }
  });

  it("applies boosts through all public field aliases", async () => {
    const cases: Array<[
      OkfSearchField,
      OkfSearchField,
      number,
      string,
      string,
    ]> = [
      ["resource", "body", 0.1, "target", "control"],
      ["title", "body", 0.1, "target", "control"],
      ["heading", "body", 0.1, "target", "control"],
      ["description", "body", 0.1, "target", "control"],
      ["tags", "body", 0.1, "target", "control"],
      ["type", "body", 0.1, "target", "control"],
      ["sources", "title", 10, "control", "target"],
      ["body", "title", 10, "control", "target"],
    ];

    for (const [
      targetField,
      controlField,
      boost,
      defaultFirst,
      customizedFirst,
    ] of cases) {
      const term = `${targetField}translationneedle`;
      const okf = await open({
        "target.md": fieldDocument(targetField, term),
        "control.md": fieldDocument(controlField, term),
      });
      const fields = [targetField, controlField];
      const baseline = resultFields(okf, term, { fields });
      const customized = resultFields(okf, term, boostOptions(
        { [targetField]: boost },
        { fields },
      ));

      expect(baseline).toEqual([
        {
          documentId: defaultFirst,
          matchedFields: [
            defaultFirst === "target"
              ? targetField
              : controlField,
          ],
        },
        {
          documentId: defaultFirst === "target"
            ? "control"
            : "target",
          matchedFields: [
            defaultFirst === "target"
              ? controlField
              : targetField,
          ],
        },
      ]);
      expect(customized).toEqual([
        {
          documentId: customizedFirst,
          matchedFields: [
            customizedFirst === "target"
              ? targetField
              : controlField,
          ],
        },
        {
          documentId: customizedFirst === "target"
            ? "control"
            : "target",
          matchedFields: [
            customizedFirst === "target"
              ? controlField
              : targetField,
          ],
        },
      ]);
    }
  });

  it("uses direct boosts without changing match eligibility", async () => {
    const term = "orderboostneedle";
    const okf = await open(titleBodyFiles(term));

    const fields = ["title", "body"] as const;

    expect(okf.search(term, { fields }).map((hit) => hit.documentId)).toEqual([
      "title",
      "body",
    ]);
    expect(okf.search(term, boostOptions({
      title: 0.5,
    }, { fields })).map((hit) => hit.documentId)).toEqual([
      "body",
      "title",
    ]);
  });

  it("changes the representative section through the public fields", async () => {
    const term = "representativeboostneedle";
    const okf = await open({
      "representative.md": concept(
        "type: note",
        `# ${term}\nheading filler\n# Body section\n${term}`,
      ),
    });

    expect(okf.search(term).map((hit) => ({
      sectionId: hit.sectionId,
      matchedFields: hit.matchedFields,
    }))).toEqual([{
      sectionId: `representative#${term}`,
      matchedFields: ["heading"],
    }]);
    expect(okf.search(term, boostOptions({
      heading: 0.1,
      body: 10,
    })).map((hit) => ({
      sectionId: hit.sectionId,
      matchedFields: hit.matchedFields,
    }))).toEqual([{
      sectionId: "representative#body-section",
      matchedFields: ["body"],
    }]);
  });

  it("keeps fields, filters, and document deduplication independent", async () => {
    const term = "interactionboostneedle";
    const body = `# First\n${term}\n# Second\n${term}`;
    const okf = await open({
      "allowed.md": concept(`
        type: note
        title: ${term}
      `, body),
      "filtered.md": concept(`
        type: recipe
        title: ${term}
      `, body),
    });

    expect(okf.search(term, boostOptions({
      title: 10,
    }, {
      fields: ["body"],
      where: { types: ["note"] },
    })).map((hit) => ({
      documentId: hit.documentId,
      sectionId: hit.sectionId,
      matchedFields: hit.matchedFields,
    }))).toEqual([{
      documentId: "allowed",
      sectionId: "allowed#first",
      matchedFields: ["body"],
    }]);
  });

  it("rejects malformed boost containers", async () => {
    const term = "boostvalidation";
    const okf = await open({
      "validation.md": concept("type: note", term),
    });
    const malformed: unknown[] = [
      null,
      [],
      () => undefined,
      "object",
      1,
      1n,
      true,
      Symbol("container"),
    ];
    const error = new TypeError(
      "options.boost must be an object",
    );

    for (const boost of malformed) {
      expect(() => okf.search(
        term,
        boostOptions(boost),
      )).toThrowError(error);
    }

    expect(okf.search(term, boostOptions(undefined))).toEqual(
      okf.search(term),
    );
  });

  it("accepts planned boost object shapes without mutating them", async () => {
    const term = "shapeboostneedle";
    const okf = await open(titleBodyFiles(term));
    const expected = okf.search(term, boostOptions(
      { title: 0.1 },
      { fields: ["title", "body"] },
    ));

    class BoostContainer {
      title = 0.1;
    }

    const nullPrototypeBoosts = Object.assign(
      Object.create(null) as object,
      { title: 0.1 },
    );
    const boostShapes: unknown[] = [
      { title: 0.1 },
      Object.freeze({ title: 0.1 }),
      new BoostContainer(),
      nullPrototypeBoosts,
    ];

    for (const boost of boostShapes) {
      expect(okf.search(term, boostOptions(boost, {
        fields: ["title", "body"],
      }))).toEqual(expected);
    }

    const frozenBoosts = Object.freeze({ title: 0.1 });
    const frozenOptions = Object.freeze(
      boostOptions(frozenBoosts, {
        fields: ["title", "body"],
      }),
    );

    expect(okf.search(term, frozenOptions)).toEqual(expected);
    expect(okf.search(term, frozenOptions)).toEqual(expected);
    expect(frozenOptions).toEqual({
      fields: ["title", "body"],
      boost: { title: 0.1 },
    });
    expect(Object.isFrozen(frozenOptions)).toBe(true);
    expect(Object.isFrozen(frozenBoosts)).toBe(true);
  });

  it("enforces enumerable own boost keys", async () => {
    const term = "boostkeys";
    const okf = await open({
      "validation.md": concept("type: note", term),
    });
    const unknownSymbol = Symbol("unknown");
    const invalidBoostKeys: PropertyKey[] = [
      "headingPath",
      "sourceText",
      "text",
      "documentId",
      "unknown",
      unknownSymbol,
    ];
    const error = new TypeError(
      "options.boost must contain only valid OkfSearchField keys",
    );

    for (const key of invalidBoostKeys) {
      expect(() => okf.search(
        term,
        boostOptions({ [key]: 1 }),
      )).toThrowError(error);
    }
  });

  it("uses supported non-enumerable keys and ignores other hidden keys", async () => {
    const term = "descriptorboostneedle";
    const okf = await open(titleBodyFiles(term));
    const expected = okf.search(term, boostOptions(
      { title: 0.1 },
      { fields: ["title", "body"] },
    ));
    const hiddenSymbol = Symbol("hidden");
    const boosts: object = {};

    Object.defineProperties(boosts, {
      title: { value: 0.1 },
      ignored: { value: true },
      [hiddenSymbol]: { value: true },
    });

    expect(okf.search(term, boostOptions(boosts, {
      fields: ["title", "body"],
    }))).toEqual(expected);
  });

  it("ignores inherited keys inside boost objects", async () => {
    const term = "inheritedboostneedle";
    const okf = await open(titleBodyFiles(term));
    const fields: OkfSearchOptions["fields"] = ["title", "body"];
    const baseline = okf.search(term, { fields });
    const inheritedSymbol = Symbol("inherited");
    const boostsPrototype = {
      title: 0.1,
      unknown: true,
      [inheritedSymbol]: true,
    };

    expect(okf.search(term, boostOptions(
      Object.create(boostsPrototype),
      { fields },
    ))).toEqual(baseline);
  });

  it("reads inherited top-level boost through normal property access", async () => {
    const term = "topinheritanceboostneedle";
    const okf = await open(titleBodyFiles(term));
    const expected = okf.search(term, boostOptions(
      { title: 0.1 },
      { fields: ["title", "body"] },
    ));
    const inheritedValid = Object.assign(Object.create({
      boost: { title: 0.1 },
    }) as object, {
      fields: ["title", "body"],
    }) as OkfSearchOptions;
    const inheritedInvalid = Object.assign(Object.create({
      boost: null,
    }) as object, {
      fields: ["title", "body"],
    }) as OkfSearchOptions;

    expect(okf.search(term, inheritedValid)).toEqual(expected);
    expect(() => okf.search(term, inheritedInvalid)).toThrowError(
      new TypeError("options.boost must be an object"),
    );
  });

  it("accepts endpoints and rejects every invalid boost value", async () => {
    const term = "numberboostneedle";
    const okf = await open(titleBodyFiles(term));

    expect(okf.search(term, boostOptions({
      title: 0.1,
    }, {
      fields: ["title", "body"],
    })).map((hit) => hit.documentId)).toEqual([
      "body",
      "title",
    ]);
    expect(okf.search(term, boostOptions({
      body: 10,
    })).map((hit) => hit.documentId)).toEqual([
      "body",
      "title",
    ]);

    const invalidValues: unknown[] = [
      0,
      -1,
      0.09,
      10.01,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      "1",
      new Number(1),
      null,
      true,
      1n,
      Symbol("value"),
      [],
      {},
      () => 1,
      undefined,
    ];
    const error = new TypeError(
      "options.boost.title must be a finite number between 0.1 and 10, inclusive",
    );

    for (const title of invalidValues) {
      expect(() => okf.search(
        term,
        boostOptions({ title }),
      )).toThrowError(error);
    }
  });

  it("snapshots each boost once per search and propagates access errors", async () => {
    const term = "snapshotboostneedle";
    const okf = await open(titleBodyFiles(term));
    let reads = 0;
    const boosts = Object.defineProperty({}, "title", {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? 0.1 : 10;
      },
    });
    const options = boostOptions(boosts, {
      fields: ["title", "body"],
    });

    expect(okf.search(term, options).map((hit) => hit.documentId)).toEqual([
      "body",
      "title",
    ]);
    expect(reads).toBe(1);
    expect(okf.search(term, options).map((hit) => hit.documentId)).toEqual([
      "title",
      "body",
    ]);
    expect(reads).toBe(2);

    const getterError = new Error("getter sentinel");
    const throwingBoosts = Object.defineProperty({}, "title", {
      enumerable: true,
      get() {
        throw getterError;
      },
    });
    let thrown: unknown;

    try {
      okf.search(term, boostOptions(throwingBoosts));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(getterError);
  });

  it("propagates boost proxy errors unchanged", async () => {
    const okf = await open({
      "proxy.md": concept("type: note", "proxyboostneedle"),
    });
    const boostError = new Error("boost proxy sentinel");
    const options = boostOptions(new Proxy({}, {
      ownKeys() {
        throw boostError;
      },
    }));
    let thrown: unknown;

    try {
      okf.search("proxyboostneedle", options);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(boostError);
  });

  it("keeps full option validation precedence before empty returns", async () => {
    const term = "precedenceboostneedle";
    const okf = await open({
      "precedence.md": concept("type: note", term),
    });
    const earlierCases: Array<[
      OkfSearchOptions,
      string,
    ]> = [
      [
        { asOf: new Date(Number.NaN) },
        "options.asOf must be a valid Date",
      ],
      [
        { limit: -1 },
        "options.limit must be a finite non-negative integer",
      ],
      [
        { match: "invalid" as OkfSearchOptions["match"] },
        'options.match must be "any" or "all"',
      ],
      [
        { fields: [] },
        "options.fields must be a non-empty array",
      ],
      [
        {
          fields: ["unknown"] as unknown as OkfSearchOptions["fields"],
        },
        "options.fields must contain only valid OkfSearchField values",
      ],
      [
        { fuzzy: "true" as unknown as OkfSearchOptions["fuzzy"] },
        "options.fuzzy must be a boolean or a finite number between 0 and 1, inclusive",
      ],
      [
        { where: null as unknown as OkfSearchOptions["where"] },
        "options.where must be an object",
      ],
      [
        {
          where: { unknown: true } as unknown as OkfSearchOptions["where"],
        },
        "options.where must contain only valid filter names",
      ],
      [
        {
          where: { types: "note" } as unknown as OkfSearchOptions["where"],
        },
        "options.where.types must be an array",
      ],
      [
        {
          where: { tagsAny: "tag" } as unknown as OkfSearchOptions["where"],
        },
        "options.where.tagsAny must be an array",
      ],
      [
        {
          where: { statuses: ["pending"] } as unknown as OkfSearchOptions["where"],
        },
        "options.where.statuses must contain only valid OkfStatus values",
      ],
      [
        {
          where: { trustTiers: ["manual"] } as unknown as OkfSearchOptions["where"],
        },
        "options.where.trustTiers must contain only valid OkfTrustTier values",
      ],
      [
        {
          where: { stale: "false" } as unknown as OkfSearchOptions["where"],
        },
        "options.where.stale must be a boolean",
      ],
    ];

    for (const [index, [earlier, message]] of earlierCases.entries()) {
      const expected = new TypeError(message);

      expect(() => okf.search(
        "",
        boostOptions(null, earlier),
      )).toThrowError(expected);

      if (index !== 1) {
        expect(() => okf.search(
          term,
          boostOptions(null, {
            ...earlier,
            limit: 0,
          }),
        )).toThrowError(expected);
      }
    }

    const invalidWhereSuffixes: Array<[
      OkfSearchOptions["where"],
      string,
    ]> = [
      [
        {
          types: "note",
          tagsAny: "tag",
          statuses: ["pending"],
          trustTiers: ["manual"],
          stale: "false",
        } as unknown as OkfSearchOptions["where"],
        "options.where.types must be an array",
      ],
      [
        {
          tagsAny: "tag",
          statuses: ["pending"],
          trustTiers: ["manual"],
          stale: "false",
        } as unknown as OkfSearchOptions["where"],
        "options.where.tagsAny must be an array",
      ],
      [
        {
          statuses: ["pending"],
          trustTiers: ["manual"],
          stale: "false",
        } as unknown as OkfSearchOptions["where"],
        "options.where.statuses must contain only valid OkfStatus values",
      ],
      [
        {
          trustTiers: ["manual"],
          stale: "false",
        } as unknown as OkfSearchOptions["where"],
        "options.where.trustTiers must contain only valid OkfTrustTier values",
      ],
      [
        { stale: "false" } as unknown as OkfSearchOptions["where"],
        "options.where.stale must be a boolean",
      ],
    ];

    for (const [where, message] of invalidWhereSuffixes) {
      expect(() => okf.search("", boostOptions(null, {
        where,
      }))).toThrowError(new TypeError(message));
    }
  });

  it("orders boost key and value errors before empty returns", async () => {
    const term = "boostprecedenceneedle";
    const okf = await open({
      "precedence.md": concept("type: note", term),
    });
    const boostNameError = new TypeError(
      "options.boost must contain only valid OkfSearchField keys",
    );
    const unknownSymbol = Symbol("unknown");

    for (const options of [
      boostOptions({ unknown: true, title: 0 }),
      boostOptions({ title: 0, headingPath: 1 }),
      boostOptions({ [unknownSymbol]: true, title: 0 }),
      boostOptions({ title: 0, [unknownSymbol]: true }),
    ]) {
      expect(() => okf.search("", options)).toThrowError(boostNameError);
      expect(() => okf.search(term, {
        ...options,
        limit: 0,
      })).toThrowError(boostNameError);
    }

    const orderedFields: readonly OkfSearchField[] = [
      "resource",
      "title",
      "heading",
      "description",
      "tags",
      "type",
      "sources",
      "body",
    ];

    for (let index = 0; index < orderedFields.length; index++) {
      const suffix = Object.fromEntries(
        orderedFields.slice(index).reverse().map((field) => [field, 0]),
      );
      const first = orderedFields[index]!;
      const error = new TypeError(
        `options.boost.${first} must be a finite number between 0.1 and 10, inclusive`,
      );

      expect(() => okf.search("", boostOptions(suffix)))
        .toThrowError(error);
      expect(() => okf.search(term, boostOptions(suffix, {
        limit: 0,
      }))).toThrowError(error);
    }

    const invalidContainer = boostOptions(null);
    const invalidContainerError = new TypeError(
      "options.boost must be an object",
    );
    expect(() => okf.search("", invalidContainer)).toThrowError(
      invalidContainerError,
    );
    expect(() => okf.search(term, {
      ...invalidContainer,
      limit: 0,
    })).toThrowError(invalidContainerError);

    expect(okf.search("", boostOptions({ title: 0.1 }))).toEqual([]);
    expect(okf.search(term, boostOptions({ body: 10 }, {
      limit: 0,
    }))).toEqual([]);
  });
});

describe("search result contract", () => {
  it("accepts equivalent LF and CRLF nested-heading documents", async () => {
    const source = concept(
      "type: note",
      "# Parent\n\n## Child\nlineendingneedle",
    );

    for (const newline of ["\n", "\r\n"] as const) {
      const okf = await open({
        "nested.md": source.replaceAll("\n", newline),
      });
      const projections = okf.search("lineendingneedle").map((hit) => ({
        headingPath: hit.headingPath,
        startLine: hit.startLine,
        endLine: hit.endLine,
        snippet: hit.snippet,
      }));

      expect(projections).toEqual([
        {
          headingPath: "Parent > Child",
          startLine: 6,
          endLine: 7,
          snippet: "lineendingneedle",
        },
      ]);
    }
  });
});

describe("search where filters", () => {
  it("rejects malformed containers, names, facets, and entries", async () => {
    const okf = await open({
      "validation.md": concept(
        "type: note",
        "wherevalidation",
      ),
    });
    const unknownSymbol = Symbol("unknown");
    const cases: Array<[unknown, string]> = [
      [null, "options.where must be an object"],
      [[], "options.where must be an object"],
      ["types", "options.where must be an object"],
      [42, "options.where must be an object"],
      [true, "options.where must be an object"],
      [
        { unknown: [] },
        "options.where must contain only valid filter names",
      ],
      [
        { [unknownSymbol]: [] },
        "options.where must contain only valid filter names",
      ],
      [
        { types: undefined },
        "options.where.types must be an array",
      ],
      [
        { tagsAny: "tag" },
        "options.where.tagsAny must be an array",
      ],
      [
        { statuses: null },
        "options.where.statuses must be an array",
      ],
      [
        { trustTiers: {} },
        "options.where.trustTiers must be an array",
      ],
      [
        { types: new Array(1) },
        "options.where.types must contain only strings",
      ],
      [
        { types: ["note", 1] },
        "options.where.types must contain only strings",
      ],
      [
        { tagsAny: new Array(1) },
        "options.where.tagsAny must contain only strings",
      ],
      [
        { tagsAny: ["tag", false] },
        "options.where.tagsAny must contain only strings",
      ],
      [
        { statuses: ["stable", "pending"] },
        "options.where.statuses must contain only valid OkfStatus values",
      ],
      [
        { trustTiers: ["unverified", "manual"] },
        "options.where.trustTiers must contain only valid OkfTrustTier values",
      ],
      [
        { stale: undefined },
        "options.where.stale must be a boolean",
      ],
      [
        { stale: null },
        "options.where.stale must be a boolean",
      ],
      [
        { stale: "false" },
        "options.where.stale must be a boolean",
      ],
      [
        { stale: 0 },
        "options.where.stale must be a boolean",
      ],
    ];

    for (const [where, message] of cases) {
      expect(() => okf.search("wherevalidation", {
        where: where as OkfSearchOptions["where"],
      })).toThrowError(new TypeError(message));
    }
  });

  it("validates where after existing options and before empty results", async () => {
    const okf = await open({
      "validation.md": concept(
        "type: note",
        "wherevalidation",
      ),
    });
    const invalidWhere = {
      types: "note",
    } as unknown as OkfSearchOptions["where"];
    const whereError = new TypeError(
      "options.where.types must be an array",
    );

    expect(() => okf.search("", {
      where: invalidWhere,
    })).toThrowError(whereError);
    expect(() => okf.search("wherevalidation", {
      where: invalidWhere,
      limit: 0,
    })).toThrowError(whereError);

    const earlierOptions: Array<[
      OkfSearchOptions,
      TypeError,
    ]> = [
      [
        { asOf: new Date(Number.NaN) },
        new TypeError(
          "options.asOf must be a valid Date",
        ),
      ],
      [
        { limit: -1 },
        new TypeError(
          "options.limit must be a finite non-negative integer",
        ),
      ],
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
          fields: ["unknown"] as unknown as OkfSearchOptions["fields"],
        },
        new TypeError(
          "options.fields must contain only valid OkfSearchField values",
        ),
      ],
      [
        { fuzzy: "true" as unknown as OkfSearchOptions["fuzzy"] },
        new TypeError(
          "options.fuzzy must be a boolean or a finite number between 0 and 1, inclusive",
        ),
      ],
    ];

    for (const [earlier, error] of earlierOptions) {
      expect(() => okf.search("wherevalidation", {
        ...earlier,
        where: invalidWhere,
      })).toThrowError(error);
    }
  });

  it("keeps every metadata state eligible when filters are omitted", async () => {
    const okf = await open({
      "draft-unverified-stale.md": concept(`
        type: note
        status: draft
        stale_after: 2026-08-24T11:00:00Z
      `, "visibilityneedle"),
      "stable-machine-fresh.md": concept(`
        type: note
        status: stable
        stale_after: 2026-08-24T13:00:00Z
        verified:
          - by: process:builder
            at: 2026-08-24T10:00:00Z
      `, "visibilityneedle"),
      "deprecated-human-fresh.md": concept(`
        type: note
        status: deprecated
        stale_after: 2026-08-24T13:00:00Z
        verified:
          - by: human:alice
            at: 2026-08-24T10:00:00Z
      `, "visibilityneedle"),
    });
    const asOf = new Date("2026-08-24T12:00:00Z");

    expect(okf.search("visibilityneedle", { asOf })
      .map((hit) => hit.documentId)
      .sort()).toEqual([
      "deprecated-human-fresh",
      "draft-unverified-stale",
      "stable-machine-fresh",
    ]);
  });

  it("keeps valid empty and duplicate filters without mutating input", async () => {
    const okf = await open({
      "stable.md": concept(`
        type: note
        tags: [filtertag]
        status: stable
        stale_after: 2999-01-01T00:00:00Z
        verified:
          - by: human:alice
            at: 2026-08-24T10:00:00Z
      `, "wherecontract"),
      "draft.md": concept(`
        type: recipe
        tags: [other]
        status: draft
        verified:
          - by: process:builder
            at: 2026-08-24T10:00:00Z
      `, "wherecontract"),
      "deprecated.md": concept(`
        type: note
        tags: [other]
        status: deprecated
      `, "wherecontract"),
    });
    const all = okf.search("wherecontract");
    const where: OkfSearchOptions["where"] = {
      types: ["note", "note", "unknown-type"],
      tagsAny: ["filtertag", "filtertag", "unknown-tag"],
      statuses: ["stable", "stable"],
      trustTiers: ["human-reviewed", "human-reviewed"],
      stale: false,
    };
    const before = {
      types: [...where.types!],
      tagsAny: [...where.tagsAny!],
      statuses: [...where.statuses!],
      trustTiers: [...where.trustTiers!],
      stale: where.stale,
    };

    expect(okf.search("wherecontract", {
      where,
    })).toEqual([
      expect.objectContaining({
        documentId: "stable",
      }),
    ]);
    expect(okf.search("wherecontract", {
      where: { types: ["unknown-type"] },
    })).toEqual([]);
    expect(okf.search("wherecontract", {
      where: { tagsAny: ["unknown-tag"] },
    })).toEqual([]);
    expect(okf.search("wherecontract", {
      where: {},
    })).toEqual(all);
    expect(okf.search("wherecontract", {
      where: {
        types: [],
        tagsAny: [],
        statuses: [],
        trustTiers: [],
      },
    })).toEqual(all);
    expect(where).toEqual(before);
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

    const searchIds = (
      fuzzy?: OkfSearchOptions["fuzzy"],
    ) => (fuzzy === undefined
      ? okf.search("alphi")
      : okf.search("alphi", { fuzzy }))
      .map((hit) => hit.documentId);

    expect(searchIds()).toEqual([]);
    expect(searchIds(false)).toEqual([]);
    expect(searchIds(0)).toEqual([]);

    for (const fuzzy of [true, 0.2, 1]) {
      expect(searchIds(fuzzy)).toEqual(["alpha"]);
    }
  });

  it("keeps distinct numeric fuzzy thresholds observable", async () => {
    const okf = await open({
      "threshold.md": concept(
        "type: note",
        "abcdefghij",
      ),
    });
    const query = "abxdeyghij";

    const searchIds = (fuzzy: number) =>
      okf.search(query, { fuzzy })
        .map((hit) => hit.documentId);

    expect(searchIds(0.1)).toEqual([]);
    expect(searchIds(0.2)).toEqual(["threshold"]);
    expect(searchIds(1)).toEqual([]);
  });

  it("combines numeric fuzzy matching with field, filter, and limit options", async () => {
    const okf = await open({
      "allowed.md": concept(
        "type: note\ntitle: Unrelated title",
        "alpha",
      ),
      "filtered.md": concept(
        "type: recipe\ntitle: Unrelated title",
        "alpha",
      ),
    });

    expect(okf.search("alphi", {
      fuzzy: 0.2,
      fields: ["body"],
      where: { types: ["note"] },
      limit: 1,
    }).map((hit) => hit.documentId)).toEqual(["allowed"]);
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
      fuzzy: 0.2,
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
      "options.fuzzy must be a boolean or a finite number between 0 and 1, inclusive",
    );

    for (const fuzzy of [
      null,
      "true",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -0.1,
      1.1,
      new Number(0.2),
      () => 0.2,
      {},
    ]) {
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

  it("returns exact and derived titles by document ID", async () => {
    const okf = await open({
      "explicit.md": concept(`
        type: note
        title: Exact Frontmatter Title
      `, "sharedtitlebody"),
      "nested/derived-title.md": concept(
        "type: note",
        "sharedtitlebody",
      ),
    });

    const titlesByDocumentId = Object.fromEntries(
      okf.search("sharedtitlebody", {
        limit: 10,
      }).map((hit) => [
        hit.documentId,
        hit.title,
      ]),
    );

    expect(titlesByDocumentId).toEqual({
      explicit: "Exact Frontmatter Title",
      "nested/derived-title": "Derived title",
    });
  });

  it("returns document IDs and replaces records by logical identity", async () => {
    const okf = await open({});

    okf.ingest({
      path: "identity/guide.md",
      markdown: concept(`
        type: note
        title: Stable Guide
      `, "oldtopicneedle"),
    });

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
