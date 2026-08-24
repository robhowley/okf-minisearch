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
  it("normalizes aliases and replaces one logical identity", async () => {
    const okf = await emptySearch();

    expect(okf.ingest).toBeTypeOf("function");

    const added = okf.ingest({
      path: "./a//b/./c.md",
      markdown: concept(`
        type: note
        unknown: accepted
      `, "oldaliasword"),
    });

    expect(added.document.id).toBe("a/b/c");
    expect(added.diagnostics).toEqual([]);
    expect(added.records).toEqual([
      expect.objectContaining({
        id: "a/b/c#root",
        documentId: "a/b/c",
        path: "a/b/c.md",
      }),
    ]);

    const replacement = okf.ingest({
      path: "a/./b//c.md",
      markdown: concept("type: changed", "newaliasword"),
    });

    expect(replacement.document).toMatchObject({
      id: "a/b/c",
      type: "changed",
    });
    expect(replacement.records.map((record) => record.path)).toEqual([
      "a/b/c.md",
    ]);
    expect(okf.search("oldaliasword")).toEqual([]);
    expect(okf.search("newaliasword")).toEqual([
      expect.objectContaining({
        documentId: "a/b/c",
        path: "a/b/c.md",
      }),
    ]);
  });

  it.each([
    ["empty", "", "<input>"],
    ["dot-only", ".", "<input>"],
    ["dot aliases", "././", "<input>"],
    ["terminal slash", "manual.md/", "<input>"],
    ["terminal dot", "manual.md/.", "<input>"],
    ["POSIX absolute", "/private/secret.md", "<input>"],
    ["drive absolute", "C:/secret.md", "<input>"],
    ["drive backslash", "C:\\secret.md", "<input>"],
    ["drive relative", "C:secret.md", "<input>"],
    ["UNC", "\\\\server\\share.md", "<input>"],
    ["leading traversal", "../secret.md", "<input>"],
    ["nested traversal", "a/../secret.md", "<input>"],
    ["bad extension", "./notes.MD", "notes.MD"],
    ["reserved index", "./nested//index.md", "nested/index.md"],
    ["reserved log", "nested/./log.md", "nested/log.md"],
  ])("rejects %s before parsing or mutation", async (
    _case,
    path,
    ownedPath,
  ) => {
    const okf = await emptySearch();
    okf.ingest({
      path: "seed.md",
      markdown: concept("type: seed", "preservedseedword"),
    });

    let failure: unknown;

    try {
      okf.ingest({
        path,
        markdown: "not markdown rejectednewword",
      });
      expect.unreachable("ingest should fail");
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(OkfError);
    expect(failure).toMatchObject({
      code: "ERR_OKF_FIELD",
      path: ownedPath,
      field: "path",
      message: `Invalid OKF field: ${ownedPath} (path)`,
    });
    expect(Object.hasOwn(failure as object, "code")).toBe(true);
    expect(Object.hasOwn(failure as object, "path")).toBe(true);
    expect(Object.hasOwn(failure as object, "field")).toBe(true);

    if (ownedPath === "<input>" && path) {
      expect((failure as Error).message).not.toContain(path);
    }

    expect(okf.search("preservedseedword")).toEqual([
      expect.objectContaining({
        documentId: "seed",
        path: "seed.md",
      }),
    ]);
    expect(okf.search("rejectednewword")).toEqual([]);
  });

  it("keeps case and literal backslash identities distinct", async () => {
    const okf = await emptySearch();

    for (const [path, term] of [
      ["Guide.md", "upperguideneedle"],
      ["guide.md", "lowerguideneedle"],
      ["a/b.md", "nestedslashneedle"],
      ["a\\b.md", "literalbackslashneedle"],
    ]) {
      okf.ingest({
        path,
        markdown: concept("type: note", term),
      });
    }

    expect(okf.search("upperguideneedle")).toEqual([
      expect.objectContaining({ documentId: "Guide", path: "Guide.md" }),
    ]);
    expect(okf.search("lowerguideneedle")).toEqual([
      expect.objectContaining({ documentId: "guide", path: "guide.md" }),
    ]);
    expect(okf.search("nestedslashneedle")).toEqual([
      expect.objectContaining({ documentId: "a/b", path: "a/b.md" }),
    ]);
    expect(okf.search("literalbackslashneedle")).toEqual([
      expect.objectContaining({ documentId: "a\\b", path: "a\\b.md" }),
    ]);
  });

  it("preserves prior records and metadata when an alias replacement is malformed", async () => {
    const okf = await emptySearch();
    const added = okf.ingest({
      path: "stable/manual.md",
      markdown: concept(`
        type: original
        title: Preserved Metadata
        tags: [kept]
      `, "# First\noldfirstneedle\n## Second\noldsecondneedle"),
    });

    expect(added.records).toHaveLength(2);

    expect(() => okf.ingest({
      path: "./stable//./manual.md",
      markdown: concept(`
        title: Replacementtitleword
        tags: [changed]
        type: [
      `, "replacementnewword"),
    })).toThrow(expect.objectContaining({
      code: "ERR_OKF_PARSE",
      path: "stable/manual.md",
    }));

    for (const term of ["oldfirstneedle", "oldsecondneedle"]) {
      expect(okf.search(term, {
        where: {
          types: ["original"],
          tagsAny: ["kept"],
        },
      })).toEqual([
        expect.objectContaining({
          documentId: "stable/manual",
          path: "stable/manual.md",
        }),
      ]);
    }

    expect(okf.search("replacementnewword")).toEqual([]);
    expect(okf.search("Replacementtitleword")).toEqual([]);
  });

  it("does not apply ingest identity rules to metadata or body links", async () => {
    const okf = await emptySearch();
    const result = okf.ingest({
      path: "./links.md",
      markdown: concept(`
        type: note
        resource: ../target
        sources:
          - resource: ../source
      `, "link [target](../body.md) metadatapathneedle"),
    });

    expect(result.document.resource).toBe("../target");
    expect(result.document.sources).toEqual([
      expect.objectContaining({ resource: "../source" }),
    ]);
    expect(result.records[0]).toMatchObject({
      path: "links.md",
      resource: "../target",
      text: "link [target](../body.md) metadatapathneedle",
    });
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
