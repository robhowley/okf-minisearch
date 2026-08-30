import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import MiniSearch from "minisearch";

import * as browserApi from "../src/browser.js";
import {
  OkfError,
  createOkfSearch,
  openOkf,
} from "../src/browser.js";
import type { OkfSearch } from "../src/browser.js";
import { concept } from "./support/bundle.js";

type FileDouble = {
  name: string;
  type?: string;
  webkitRelativePath?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

function file(
  name: string,
  contents: string | Uint8Array,
  options: Pick<FileDouble, "type" | "webkitRelativePath"> = {},
): File & FileDouble {
  const bytes = typeof contents === "string"
    ? new TextEncoder().encode(contents)
    : contents;

  return {
    name,
    ...options,
    arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
  } as File & FileDouble;
}

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("browser openOkf", () => {
  it("exports the same common runtime API as Node", () => {
    expect(Object.keys(browserApi).sort()).toEqual([
      "OkfError",
      "createOkfSearch",
      "openOkf",
      "validateOkfDocument",
    ]);
  });

  it("snapshots FileList membership before reading", async () => {
    const selected = file(
      "selected.md",
      concept("type: selected", "snapshotneedle"),
    );
    let release: (() => void) | undefined;
    selected.arrayBuffer = async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return new TextEncoder().encode(
        concept("type: selected", "snapshotneedle"),
      ).buffer as ArrayBuffer;
    };
    const values: File[] = [selected];
    const list = {
      0: selected,
      length: 1,
      item: (index: number) => values[index] ?? null,
      [Symbol.iterator]: () => values[Symbol.iterator](),
    } as unknown as FileList;

    const opening = openOkf(list);
    await Promise.resolve();
    values.splice(0, 1, file(
      "replacement.md",
      concept("type: replacement", "replacementneedle"),
    ));
    release!();

    const okf = await opening;
    expect(okf.search("snapshotneedle")).toHaveLength(1);
    expect(okf.search("replacementneedle")).toEqual([]);
  });

  it("filters by exact lowercase names and ignores MIME type", async () => {
    const okf = await openOkf([
      file("lower.md", concept("type: lower", "lowerneedle"), {
        type: "application/octet-stream",
      }),
      file("UPPER.MD", concept("type: upper", "upperneedle")),
      file("index.md", concept("type: reserved", "indexneedle")),
      file("log.md", concept("type: reserved", "logneedle")),
      file("notes.txt", concept("type: text", "textneedle")),
    ]);

    expect(okf.search("lowerneedle")).toHaveLength(1);
    expect(okf.search("upperneedle")).toEqual([]);
    expect(okf.search("indexneedle")).toEqual([]);
    expect(okf.search("logneedle")).toEqual([]);
    expect(okf.search("textneedle")).toEqual([]);
  });

  it("strips the selected directory and normalizes virtual paths", async () => {
    const okf = await openOkf([
      file("recovery.md", concept("type: guide", "browserpathneedle"), {
        webkitRelativePath: "knowledge/./guides//recovery.md",
      }),
      file("flat.md", concept("type: flat", "flatpathneedle")),
    ]);

    expect(okf.search("browserpathneedle")).toEqual([
      expect.objectContaining({
        documentId: "guides/recovery",
        path: "guides/recovery.md",
      }),
    ]);
    expect(okf.search("flatpathneedle")).toEqual([
      expect.objectContaining({
        documentId: "flat",
        path: "flat.md",
      }),
    ]);
  });

  it("rejects duplicate normalized identities before reading", async () => {
    const first = file(
      "guide.md",
      concept("type: guide", "firstneedle"),
    );
    const second = file(
      "guide.md",
      "not frontmatter",
      { webkitRelativePath: "knowledge/./guide.md" },
    );
    const firstRead = vi.spyOn(first, "arrayBuffer");
    const secondRead = vi.spyOn(second, "arrayBuffer");

    await expect(openOkf([first, second])).rejects.toThrowError(new OkfError(
      "ERR_OKF_FIELD",
      "guide.md",
      { field: "path" },
    ));
    expect(firstRead).not.toHaveBeenCalled();
    expect(secondRead).not.toHaveBeenCalled();
  });

  it("reads sorted files sequentially", async () => {
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = file("a.md", concept("type: a", "asequential"));
    first.arrayBuffer = async () => {
      order.push("a:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      order.push("a:end");
      return new TextEncoder().encode(firstContent()).buffer as ArrayBuffer;
    };
    const second = file("b.md", concept("type: b", "bsequential"));
    second.arrayBuffer = async () => {
      order.push("b:start");
      return new TextEncoder().encode(concept("type: b", "bsequential"))
        .buffer as ArrayBuffer;
    };

    const opening = openOkf([second, first]);
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["a:start"]);
    releaseFirst!();

    const okf = await opening;
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
    expect(okf.search("asequential")).toHaveLength(1);
    expect(okf.search("bsequential")).toHaveLength(1);
  });

  it("maps read rejection to ERR_OKF_READ with the virtual path and cause", async () => {
    const cause = new Error("read failed");
    const unreadable = file(
      "guide.md",
      concept("type: guide"),
      { webkitRelativePath: "knowledge/guides/guide.md" },
    );
    unreadable.arrayBuffer = async () => {
      throw cause;
    };

    await expect(openOkf([unreadable])).rejects.toMatchObject({
      code: "ERR_OKF_READ",
      path: "guides/guide.md",
      cause,
    });
  });

  it("maps invalid UTF-8 to ERR_OKF_PARSE with the virtual path and cause", async () => {
    const invalid = file("invalid.md", bytes([0x2d, 0x2d, 0x2d, 0x0a, 0xff]), {
      webkitRelativePath: "knowledge/invalid.md",
    });

    await expect(openOkf([invalid])).rejects.toMatchObject({
      code: "ERR_OKF_PARSE",
      path: "invalid.md",
      cause: expect.any(TypeError),
    });
  });

  it("returns a usable empty handle for empty and ineligible input", async () => {
    const empty = await openOkf([]);
    const ineligible = await openOkf([
      file("UPPER.MD", concept("type: ignored")),
      file("index.md", concept("type: ignored")),
      file("readme.txt", concept("type: ignored")),
    ]);

    for (const okf of [empty, ineligible]) {
      expect(okf.listTypes()).toEqual([]);
      expect(okf.listDegradedDocuments()).toEqual([]);
      expect(okf.search("anything")).toEqual([]);
      expect(okf.autoSuggest("anything")).toEqual([]);
    }
  });

  it("does not index any document when a later decode fails", async () => {
    const addAllSpy = vi.spyOn(MiniSearch.prototype, "addAll");
    const first = file(
      "a-valid.md",
      concept("type: valid", "validneedle"),
    );
    const firstRead = vi.spyOn(first, "arrayBuffer");
    const broken = file("z-broken.md", bytes([0xff]));

    await expect(openOkf([first, broken])).rejects.toMatchObject({
      code: "ERR_OKF_PARSE",
      path: "z-broken.md",
      cause: expect.any(TypeError),
    });
    expect(firstRead).toHaveBeenCalledTimes(1);
    expect(addAllSpy).not.toHaveBeenCalled();
  });

  it("delegates to the shared handle for search and mutations", async () => {
    const markdown = concept("type: browser", "browsermutationneedle");
    const okf = await openOkf([file("browser.md", markdown)]);

    expect(okf.autoSuggest("browsermutation")).toEqual([
      expect.objectContaining({ suggestion: "browsermutationneedle" }),
    ]);
    const result = okf.ingest({
      path: "live.md",
      markdown: concept("type: live", "liveneedle"),
    });
    expect(result.conformance).toBe("strict");
    expect(okf.listTypes()).toEqual(["browser", "live"]);
    expect(okf.remove("live.md")).toBe(true);
    expect(okf.search("liveneedle")).toEqual([]);

    const direct = createOkfSearch([{ path: "browser.md", markdown }]);
    expect(direct.search("browsermutationneedle")).toEqual(
      okf.search("browsermutationneedle"),
    );
  });
});

function firstContent(): string {
  return concept("type: a", "asequential");
}
