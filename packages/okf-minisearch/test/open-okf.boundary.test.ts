import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

async function bundle(
  files: Record<string, string | Uint8Array>,
): Promise<TestBundle> {
  const created = await createBundle(files);
  bundles.push(created);
  return created;
}

describe("openOkf concept boundary", () => {
  it("opens type-only, empty, nested, unknown, and malformed unsupported metadata", async () => {
    const tree = await bundle({
      "type-only.md": concept(`
        type: unfamiliar
        unknown_key: anything
        sources: broken
        generated: [also, broken]
        parameters: nope
      `, "boundaryneedle broken-link [missing](nope.md)"),
      "empty.md": concept("type: empty", ""),
      "nested/concept.md": concept("type: nested", "boundaryneedle nested"),
      "index.md": "not frontmatter",
      "nested/log.md": "also not frontmatter",
    });

    const okf = await openOkf(tree.root);
    const ids = okf.search("boundaryneedle", {
      limit: 10,
    }).map((hit) => hit.documentId).sort();

    expect(ids).toEqual([
      "nested/concept",
      "type-only",
    ]);
  });

  it("uses exact lowercase discovery and exact reserved names", async () => {
    const tree = await bundle({
      "lower.md": concept("type: note", "caseneedle lower"),
      "UPPER.MD": "invalid and ignored",
      "reserved/index.md": "invalid and ignored",
      "reserved/log.md": "invalid and ignored",
      "selected-index/INDEX.md": concept("type: note", "caseneedle upper index"),
      "selected-log/LOG.md": concept("type: note", "caseneedle upper log"),
    });

    const okf = await openOkf(tree.root);
    const hits = okf.search("caseneedle", {
      limit: 10,
    });

    expect(hits.map((hit) => hit.path).sort()).toEqual([
      "lower.md",
      "selected-index/INDEX.md",
      "selected-log/LOG.md",
    ]);
  });

  it("ignores nested symlinks", async () => {
    const tree = await bundle({
      "real.md": concept("type: note", "symlinkneedle real"),
    });
    const outside = await mkdtemp(
      join(tmpdir(), "okf-outside-"),
    );

    try {
      await writeFile(
        join(outside, "bad.md"),
        "not frontmatter",
      );
      await symlink(
        outside,
        join(tree.root, "linked"),
      );

      const okf = await openOkf(tree.root);
      expect(okf.search("symlinkneedle")).toHaveLength(1);
    } finally {
      await rm(outside, {
        recursive: true,
        force: true,
      });
    }
  });

  it("does not inspect siblings outside the selected root", async () => {
    const parent = await mkdtemp(
      join(tmpdir(), "okf-parent-"),
    );
    bundles.push({
      root: parent,
      cleanup: () => rm(parent, {
        recursive: true,
        force: true,
      }),
    });
    const selected = join(parent, "selected");
    await mkdir(selected);
    await writeFile(
      join(selected, "valid.md"),
      concept("type: note", "scopeneedle"),
    );
    await writeFile(
      join(parent, "bad.md"),
      "not frontmatter",
    );

    const okf = await openOkf(selected);
    expect(okf.search("scopeneedle")).toHaveLength(1);
  });

  it("reports the first selected failure in root-relative POSIX order", async () => {
    const tree = await bundle({
      "z.md": "not frontmatter",
      "nested/valid.md": concept("type: note"),
      "a.md": "not frontmatter",
    });

    await expect(openOkf(tree.root)).rejects.toMatchObject({
      code: "ERR_OKF_PARSE",
      path: "a.md",
    });
  });
});

describe("OkfError", () => {
  it.each([
    ["missing.md", "plain markdown", "ERR_OKF_PARSE", undefined],
    ["unclosed.md", "---\ntype: note\nbody", "ERR_OKF_PARSE", undefined],
    ["yaml.md", "---\ntype: [\n---\n", "ERR_OKF_PARSE", undefined],
    ["scalar.md", "---\nscalar\n---\n", "ERR_OKF_PARSE", undefined],
    ["missing-type.md", "---\ntitle: x\n---\n", "ERR_OKF_FIELD", "type"],
    ["blank-type.md", "---\ntype: '   '\n---\n", "ERR_OKF_FIELD", "type"],
    ["number-type.md", "---\ntype: 1\n---\n", "ERR_OKF_FIELD", "type"],
    ["README.md", "ordinary readme", "ERR_OKF_PARSE", undefined],
  ])("owns stable properties for %s", async (
    path,
    contents,
    code,
    field,
  ) => {
    const tree = await bundle({ [path]: contents });

    try {
      await openOkf(tree.root);
      expect.unreachable("openOkf should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(OkfError);
      expect(error).toMatchObject({ code, path });
      expect(Object.hasOwn(error as object, "code")).toBe(true);
      expect(Object.hasOwn(error as object, "path")).toBe(true);

      if (field) {
        expect(error).toMatchObject({ field });
        expect(Object.hasOwn(error as object, "field")).toBe(true);
      } else {
        expect(Object.hasOwn(error as object, "field")).toBe(false);
      }
    }
  });

  it("wraps invalid UTF-8 as a parse error with a cause", async () => {
    const bytes = new Uint8Array([
      0x2d, 0x2d, 0x2d, 0x0a,
      0x74, 0x79, 0x70, 0x65, 0x3a, 0x20,
      0xff,
    ]);
    const tree = await bundle({ "bad.md": bytes });

    try {
      await openOkf(tree.root);
      expect.unreachable("openOkf should fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "ERR_OKF_PARSE",
        path: "bad.md",
      });
      expect(Object.hasOwn(error as object, "cause")).toBe(true);
    }
  });

  it("wraps root traversal failures", async () => {
    const missing = join(
      tmpdir(),
      `missing-okf-${crypto.randomUUID()}`,
    );

    await expect(openOkf(missing)).rejects.toMatchObject({
      code: "ERR_OKF_READ",
      path: ".",
    });
  });
});
