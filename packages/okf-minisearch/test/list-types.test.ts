import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import { openOkf } from "../src/index.js";
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

async function emptySearch() {
  const tree = await createBundle({});
  bundles.push(tree);
  return openOkf(tree.root);
}

async function open(
  files: Record<string, string>,
) {
  const tree = await createBundle(files);
  bundles.push(tree);
  return openOkf(tree.root);
}

describe("listTypes", () => {
  it("returns an empty list for an empty index", async () => {
    const okf = await emptySearch();

    expect(okf.listTypes()).toEqual([]);
  });

  it("returns distinct exact startup type values", async () => {
    const okf = await open({
      "upper.md": concept('type: "Custom/Type"'),
      "lower.md": concept('type: "custom/type"'),
      "unknown.md": concept('type: "vendor/unknown"'),
    });

    expect(okf.listTypes()).toEqual([
      "Custom/Type",
      "custom/type",
      "vendor/unknown",
    ]);
  });

  it("sorts values by raw code-unit order", async () => {
    const types = ["z", "A", "😀", "é", "a", "Z"];
    const files = Object.fromEntries(
      types.map((type, index) => [
        `${index}.md`,
        concept(`type: ${JSON.stringify(type)}`),
      ]),
    );
    const okf = await open(files);

    expect(okf.listTypes()).toEqual([
      "A",
      "Z",
      "a",
      "z",
      "é",
      "😀",
    ]);
  });

  it("does not repeat a type shared by multiple startup documents", async () => {
    const okf = await open({
      "first.md": concept("type: shared"),
      "second.md": concept("type: shared"),
      "other.md": concept("type: other"),
    });

    expect(okf.listTypes()).toEqual([
      "other",
      "shared",
    ]);
  });

  it("tracks ingest, same-type replacement, different-type replacement, and removal", async () => {
    const okf = await emptySearch();

    expect(okf.listTypes()).toEqual([]);

    okf.ingest({
      path: "first.md",
      markdown: concept("type: shared", "firstword"),
    });
    expect(okf.listTypes()).toEqual(["shared"]);

    okf.ingest({
      path: "second.md",
      markdown: concept("type: shared", "secondword"),
    });
    expect(okf.listTypes()).toEqual(["shared"]);

    okf.ingest({
      path: "./first.md",
      markdown: concept("type: shared", "same-replacement-word"),
    });
    expect(okf.listTypes()).toEqual(["shared"]);

    okf.ingest({
      path: "first.md",
      markdown: concept("type: unique", "different-replacement-word"),
    });
    expect(okf.listTypes()).toEqual([
      "shared",
      "unique",
    ]);

    expect(okf.remove("./second.md")).toBe(true);
    expect(okf.listTypes()).toEqual(["unique"]);

    expect(okf.remove("second.md")).toBe(false);
    expect(okf.remove("missing.md")).toBe(false);
    expect(okf.listTypes()).toEqual(["unique"]);

    expect(okf.remove("first.md")).toBe(true);
    expect(okf.listTypes()).toEqual([]);
  });

  it("leaves types unchanged after a failed replacement", async () => {
    const okf = await emptySearch();
    okf.ingest({
      path: "original.md",
      markdown: concept("type: original", "originalword"),
    });

    expect(() => okf.ingest({
      path: "./original.md",
      markdown: concept("type: [", "replacementword"),
    })).toThrow(expect.objectContaining({
      code: "ERR_OKF_PARSE",
      path: "original.md",
    }));

    expect(okf.listTypes()).toEqual(["original"]);
    expect(okf.search("originalword")).toHaveLength(1);
    expect(okf.search("replacementword")).toEqual([]);

    okf.ingest({
      path: "original.md",
      markdown: concept("type: recovered", "recoveredword"),
    });
    expect(okf.listTypes()).toEqual(["recovered"]);
    expect(okf.search("originalword")).toEqual([]);
  });

  it("returns frozen snapshots without changing prior snapshots", async () => {
    const okf = await emptySearch();
    const empty = okf.listTypes();

    expect(empty).toEqual([]);
    expect(Object.isFrozen(empty)).toBe(true);
    expect(() => (empty as string[]).push("caller-mutation")).toThrow(
      TypeError,
    );
    expect(okf.listTypes()).toEqual([]);

    okf.ingest({
      path: "before.md",
      markdown: concept("type: before", "beforeword"),
    });
    const prior = okf.listTypes();

    expect(prior).toEqual(["before"]);
    expect(Object.isFrozen(prior)).toBe(true);

    okf.ingest({
      path: "after.md",
      markdown: concept("type: after", "afterword"),
    });

    expect(prior).toEqual(["before"]);
    expect(okf.listTypes()).toEqual([
      "after",
      "before",
    ]);
    expect(Object.isFrozen(okf.listTypes())).toBe(true);

    expect(okf.remove("after.md")).toBe(true);
    expect(prior).toEqual(["before"]);
    expect(okf.listTypes()).toEqual(["before"]);
  });
});
