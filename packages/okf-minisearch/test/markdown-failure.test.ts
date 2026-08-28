import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import MiniSearch from "minisearch";

import {
  openOkf,
  validateOkfDocument,
} from "../src/index.js";
import {
  concept,
  createBundle,
  type TestBundle,
} from "./support/bundle.js";

vi.mock("mdast-util-from-markdown", () => ({
  fromMarkdown: vi.fn(() => {
    throw new Error("injected Markdown parser failure");
  }),
}));

const bundles: TestBundle[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    bundles.splice(0).map((bundle) => bundle.cleanup()),
  );
});

describe("Markdown parser failure", () => {
  it("keeps parse failure fatal but gives unusable type fatal precedence", async () => {
    const tree = await createBundle({});
    bundles.push(tree);
    const okf = await openOkf(tree.root);
    const addAll = vi.spyOn(MiniSearch.prototype, "addAll");
    const add = vi.spyOn(MiniSearch.prototype, "add");
    const discardAll = vi.spyOn(MiniSearch.prototype, "discardAll");
    const discard = vi.spyOn(MiniSearch.prototype, "discard");

    const parseOnly = {
      path: "parse-only.md",
      markdown: concept("type: note", "parseonlyneedle"),
    };
    expect(validateOkfDocument(parseOnly)).toEqual({
      isValid: false,
      isIndexable: false,
      errors: [{
        code: "ERR_OKF_PARSE",
        path: "parse-only.md",
        message: "Cannot parse OKF concept: parse-only.md",
      }],
    });
    expect(() => okf.ingest(parseOnly)).toThrow(expect.objectContaining({
      code: "ERR_OKF_PARSE",
      path: "parse-only.md",
    }));

    const competingFatal = {
      path: "competing-fatal.md",
      markdown: concept("type: ' '", "competingfatalneedle"),
    };
    const validation = validateOkfDocument(competingFatal);
    expect(validation).toMatchObject({
      isValid: false,
      isIndexable: false,
    });
    expect(validation.errors.map((diagnostic) => diagnostic.field)).toEqual([
      "type",
      undefined,
    ]);
    expect(() => okf.ingest(competingFatal)).toThrow(expect.objectContaining({
      code: "ERR_OKF_FIELD",
      path: "competing-fatal.md",
      field: "type",
    }));

    expect(addAll).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(discardAll).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(okf.listTypes()).toEqual([]);
    expect(okf.listDegradedDocuments()).toEqual([]);
  });
});
