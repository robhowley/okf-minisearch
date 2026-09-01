import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import * as fsPromises from "node:fs/promises";
import type { Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: vi.fn(actual.readdir),
    readFile: vi.fn(actual.readFile),
  };
});

import { PrepareError } from "../src/index.js";
import { readOkfDocuments } from "../src/node.js";
import {
  createBundle,
  type TestBundle,
} from "./support/bundle.js";

const bundles: TestBundle[] = [];
const readdirMock = vi.mocked(fsPromises.readdir);
const readFileMock = vi.mocked(fsPromises.readFile);
let actualReaddir: typeof fsPromises.readdir;
let actualReadFile: typeof fsPromises.readFile;

beforeAll(async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises",
  );
  actualReaddir = actual.readdir;
  actualReadFile = actual.readFile;
});

afterEach(async () => {
  readdirMock.mockReset();
  readdirMock.mockImplementation(actualReaddir);
  readFileMock.mockReset();
  readFileMock.mockImplementation(actualReadFile);
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

function entry(
  name: string,
  kind: "directory" | "file" | "other",
): Dirent {
  return {
    name,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
  } as unknown as Dirent;
}

describe("readOkfDocuments", () => {
  it("discovers exact lowercase document files in code-unit order", async () => {
    const tree = await bundle({
      "z.md": "z",
      "a.md": "a",
      "selected-index/INDEX.md": "upper index",
      "selected-log/LOG.md": "upper log",
      "reserved/index.md": "ignored index",
      "reserved/log.md": "ignored log",
      "UPPER.MD": "ignored extension",
      "nested/b.md": "nested b",
      "nested/a.md": "nested a",
      "nested/index.md": "ignored nested index",
      "nested/log.md": "ignored nested log",
    });

    await expect(readOkfDocuments(tree.root)).resolves.toEqual([
      { path: "a.md", markdown: "a" },
      { path: "nested/a.md", markdown: "nested a" },
      { path: "nested/b.md", markdown: "nested b" },
      { path: "selected-index/INDEX.md", markdown: "upper index" },
      { path: "selected-log/LOG.md", markdown: "upper log" },
      { path: "z.md", markdown: "z" },
    ]);
  });

  it("preserves literal backslashes and ignores symlinks", async () => {
    const tree = await bundle({
      "a/b.md": "nested",
      "a\\b.md": "literal",
    });
    const outside = await mkdtemp(join(tmpdir(), "okf-prepare-outside-"));

    try {
      await writeFile(join(outside, "linked.md"), "outside file");
      await symlink(
        join(outside, "linked.md"),
        join(tree.root, "linked.md"),
      );
      await symlink(outside, join(tree.root, "linked-directory"));

      await expect(readOkfDocuments(tree.root)).resolves.toEqual([
        { path: "a/b.md", markdown: "nested" },
        { path: "a\\b.md", markdown: "literal" },
      ]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("does not inspect siblings outside the selected root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "okf-prepare-parent-"));
    const selected = join(parent, "selected");
    await mkdir(selected);
    await writeFile(join(selected, "valid.md"), "selected");
    await writeFile(join(parent, "outside.md"), "outside");
    bundles.push({
      root: parent,
      cleanup: () => rm(parent, { recursive: true, force: true }),
    });

    await expect(readOkfDocuments(selected)).resolves.toEqual([
      { path: "valid.md", markdown: "selected" },
    ]);
  });

  it("reads the normalized candidates sequentially in sorted order", async () => {
    const tree = await bundle({
      "z.md": "z",
      "a.md": "a",
      "nested/m.md": "m",
    });
    const originalReadFile = actualReadFile;
    let activeReads = 0;
    let maximumActiveReads = 0;
    const readFileSpy = readFileMock
      .mockImplementation(async (path) => {
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
        await Promise.resolve();
        try {
          return await originalReadFile(path);
        } finally {
          activeReads -= 1;
        }
      });

    await expect(readOkfDocuments(tree.root)).resolves.toEqual([
      { path: "a.md", markdown: "a" },
      { path: "nested/m.md", markdown: "m" },
      { path: "z.md", markdown: "z" },
    ]);

    expect(readFileSpy).toHaveBeenCalledTimes(3);
    expect(readFileSpy.mock.calls.map(([path]) => String(path))).toEqual([
      join(tree.root, "a.md"),
      join(tree.root, "nested/m.md"),
      join(tree.root, "z.md"),
    ]);
    expect(maximumActiveReads).toBe(1);
  });

  it("returns fresh input containers on each read", async () => {
    const tree = await bundle({ "note.md": "body" });

    const first = await readOkfDocuments(tree.root);
    const second = await readOkfDocuments(tree.root);

    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(first[0]);
    expect(second).toEqual(first);

    (first[0] as { path: string }).path = "changed.md";
    expect(second[0]!.path).toBe("note.md");
  });

  it("maps root traversal failures to a relative read error", async () => {
    const missing = join(
      tmpdir(),
      `missing-okf-prepare-${crypto.randomUUID()}`,
    );

    try {
      await readOkfDocuments(missing);
      expect.unreachable("readOkfDocuments should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PrepareError);
      expect(error).toMatchObject({
        code: "ERR_OKF_READ",
        path: ".",
        message: "Cannot read OKF path: .",
      });
      expect(Object.hasOwn(error as object, "cause")).toBe(true);
      expect((error as Error).message).not.toContain(missing);
    }
  });

  it("maps nested traversal failures and preserves their cause", async () => {
    const tree = await bundle({ "a.md": "a" });
    const cause = new Error("nested traversal failed");
    const readdirSpy = readdirMock
      .mockResolvedValueOnce([
        entry("a.md", "file"),
        entry("nested", "directory"),
      ] as never)
      .mockRejectedValueOnce(cause);
    const readFileSpy = readFileMock;

    await expect(readOkfDocuments(tree.root)).rejects.toMatchObject({
      code: "ERR_OKF_READ",
      path: "nested",
      message: "Cannot read OKF path: nested",
      cause,
    });
    expect(readdirSpy).toHaveBeenCalledTimes(2);
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("maps selected-file failures and preserves their cause", async () => {
    const tree = await bundle({ "a.md": "a" });
    const cause = new Error("file read failed");
    const readFileSpy = readFileMock
      .mockRejectedValue(cause);

    await expect(readOkfDocuments(tree.root)).rejects.toMatchObject({
      code: "ERR_OKF_READ",
      path: "a.md",
      message: "Cannot read OKF path: a.md",
      cause,
    });
    expect(readFileSpy).toHaveBeenCalledTimes(1);
  });

  it("maps invalid UTF-8 to a relative parse error", async () => {
    const tree = await bundle({
      "bad.md": new Uint8Array([0x2d, 0x2d, 0x2d, 0x0a, 0xff]),
    });

    try {
      await readOkfDocuments(tree.root);
      expect.unreachable("readOkfDocuments should fail");
    } catch (error) {
      expect(error).toBeInstanceOf(PrepareError);
      expect(error).toMatchObject({
        code: "ERR_OKF_PARSE",
        path: "bad.md",
        message: "Cannot parse OKF concept: bad.md",
      });
      expect(Object.hasOwn(error as object, "cause")).toBe(true);
      expect((error as Error).message).not.toContain(tree.root);
    }
  });

  it("preflights every identity and duplicate before reading", async () => {
    const tree = await bundle({});
    const readdirSpy = readdirMock
      .mockResolvedValue([
        entry("./a.md", "file"),
        entry("a.md", "file"),
      ] as never);
    const readFileSpy = readFileMock
      .mockRejectedValue(new Error("must not read"));

    await expect(readOkfDocuments(tree.root)).rejects.toMatchObject({
      code: "ERR_OKF_FIELD",
      path: "a.md",
      field: "path",
      message: "Invalid OKF field: a.md (path)",
    });
    expect(readdirSpy).toHaveBeenCalledTimes(1);
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("rejects unsafe candidates before any read", async () => {
    const tree = await bundle({});
    readdirMock
      .mockResolvedValue([entry("../outside.md", "file")] as never);
    const readFileSpy = readFileMock
      .mockRejectedValue(new Error("must not read"));

    await expect(readOkfDocuments(tree.root)).rejects.toMatchObject({
      code: "ERR_OKF_FIELD",
      path: "<input>",
      field: "path",
      message: "Invalid OKF field: <input> (path)",
    });
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("returns an empty array for an empty root", async () => {
    const tree = await bundle({
      "index.md": "ignored",
      "log.md": "ignored",
      "README.MD": "ignored",
    });

    await expect(readOkfDocuments(tree.root)).resolves.toEqual([]);
  });
});
