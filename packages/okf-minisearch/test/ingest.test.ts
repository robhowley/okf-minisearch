import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  OkfError,
  openOkf,
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

async function emptySearch() {
  const tree = await createBundle({});
  bundles.push(tree);
  return openOkf(tree.root);
}

describe("ingest", () => {
  it("remains public and adds a prepared concept", async () => {
    const okf = await emptySearch();

    expect(okf.ingest).toBeTypeOf("function");

    const result = okf.ingest({
      path: "./manual.md",
      markdown: concept(`
        type: future-kind
        unknown: accepted
      `, "ingestneedle added"),
    });

    expect(result.document).toMatchObject({
      id: "manual",
      type: "future-kind",
    });
    expect(result.records).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
    expect(okf.search("ingestneedle")).toEqual([
      expect.objectContaining({
        documentId: "manual",
        path: "./manual.md",
      }),
    ]);
  });

  it("replaces the same logical path after preparation", async () => {
    const okf = await emptySearch();

    okf.ingest({
      path: "./manual.md",
      markdown: concept("type: note", "oldmutationword"),
    });
    const replacement = okf.ingest({
      path: "manual.md",
      markdown: concept("type: changed", "newmutationword"),
    });

    expect(replacement.document.type).toBe("changed");
    expect(okf.search("oldmutationword")).toEqual([]);
    expect(okf.search("newmutationword")).toEqual([
      expect.objectContaining({
        documentId: "manual",
        path: "manual.md",
      }),
    ]);
  });

  it("leaves previous search state unchanged when replacement preparation fails", async () => {
    const okf = await emptySearch();

    okf.ingest({
      path: "manual.md",
      markdown: concept("type: note", "preservedmutationword"),
    });

    expect(() => okf.ingest({
      path: "manual.md",
      markdown: concept("title: missing type", "replacementword"),
    })).toThrow(OkfError);

    expect(okf.search("preservedmutationword")).toHaveLength(1);
    expect(okf.search("replacementword")).toEqual([]);
  });

  it("shares optional-facet semantics with startup concepts", async () => {
    const okf = await emptySearch();

    expect(() => okf.ingest({
      path: "malformed.md",
      markdown: concept(`
        type: note
        status: future
        verified: broken
        stale_after: yesterday
      `, "unclassifiedmutationword"),
    })).not.toThrow();

    expect(okf.search("unclassifiedmutationword")).toHaveLength(1);
    expect(okf.search("unclassifiedmutationword", {
      where: { statuses: ["stable"] },
    })).toEqual([]);
    expect(okf.search("unclassifiedmutationword", {
      where: { trustTiers: ["unverified"] },
    })).toEqual([]);
    expect(okf.search("unclassifiedmutationword", {
      where: { stale: false },
    })).toEqual([]);
  });
});
