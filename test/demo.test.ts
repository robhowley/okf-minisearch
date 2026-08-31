import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  createOkfSearch,
  validateOkfDocument,
} from "../packages/okf-minisearch/src/browser.js";
import {
  createCommittedSearchSession,
  decodeUtf8,
  isCompositionKey,
  mapFilterOptions,
  mapSearchOptions,
  readUpload,
  resolveCommittedQuery,
  resolveSearchKeyAction,
  toSearchResultText,
  transitionCombobox,
  uploadPath,
} from "../demo/app.js";

const DEMO_ROOT = path.resolve("demo");
const SAMPLE_ROOT = path.join(DEMO_ROOT, "assets/sample-bundle");
const MANIFEST_PATH = path.join(SAMPLE_ROOT, "manifest.json");

type Manifest = {
  schemaVersion: number;
  documentCount: number;
  totalBytes: number;
  documents: Array<{ path: string; bytes: number }>;
};

let manifest: Manifest;
let handle: ReturnType<typeof createOkfSearch>;

beforeAll(async () => {
  manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as Manifest;
  const documents = await Promise.all(manifest.documents.map(async (entry) => ({
    path: entry.path,
    markdown: await readFile(path.join(SAMPLE_ROOT, entry.path), "utf8"),
  })));
  handle = createOkfSearch(documents);
});

describe("demo deployment contract", () => {
  it("loads only the exact classic CDN script and project-relative assets", async () => {
    const [html, app] = await Promise.all([
      readFile(path.join(DEMO_ROOT, "index.html"), "utf8"),
      readFile(path.join(DEMO_ROOT, "app.js"), "utf8"),
    ]);
    const cdn = '<script src="https://cdn.jsdelivr.net/npm/okf-minisearch@2"></script>';

    expect(html.split(cdn)).toHaveLength(2);
    expect(html).toContain('<link rel="stylesheet" href="./styles.css">');
    expect(html).toContain('<script type="module" src="./app.js"></script>');
    expect(html.indexOf(cdn)).toBeLessThan(html.indexOf('src="./app.js"'));
    expect(html).not.toMatch(/(?:href|src)="\/(?!\/)/);
    expect(app).toContain('new URL("./assets/sample-bundle/", import.meta.url)');
    expect(app).toContain('new URL("./assets/sample-bundle/manifest.json", import.meta.url)');
    expect(app).not.toMatch(/(?:from|import)\s*[({]*["']okf-minisearch/);
    expect(app).not.toMatch(/\.(?:innerHTML|outerHTML)\s*=/);
    expect(app.match(/handle\.search\(/g)).toHaveLength(1);
  });

  it("keeps a sorted, unique manifest matching all 42 document bytes", async () => {
    const paths = manifest.documents.map((entry) => entry.path);
    const actualPaths = (await markdownPaths(SAMPLE_ROOT)).sort();
    const actualSizes = await Promise.all(paths.map(async (relativePath) =>
      (await stat(path.join(SAMPLE_ROOT, relativePath))).size));

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      documentCount: 42,
      totalBytes: 57_038,
    });
    expect(paths).toEqual([...paths].sort());
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toEqual(actualPaths);
    expect(manifest.documents.map((entry) => entry.bytes)).toEqual(actualSizes);
    expect(actualSizes.reduce((sum, bytes) => sum + bytes, 0)).toBe(57_038);
  });
});

describe("sample corpus through the local browser API", () => {
  it("indexes the expected types and one known degraded document", () => {
    expect(handle.listTypes()).toEqual(["concept", "plan"]);
    expect(handle.listDegradedDocuments()).toEqual([
      {
        documentId: "gardens/experimental-mulch-notes",
        path: "gardens/experimental-mulch-notes.md",
        diagnostics: [expect.objectContaining({
          code: "ERR_OKF_FIELD",
          path: "gardens/experimental-mulch-notes.md",
          field: "status",
        })],
      },
    ]);
  });

  it("returns a representative completion and honors structured filters", () => {
    expect(handle.autoSuggest("kiln lo", { limit: 8 })[0]).toMatchObject({
      suggestion: "kiln loading load",
      terms: ["kiln", "loading", "load"],
    });

    expect(handle.autoSuggest("seasonal pl", {
      limit: 8,
      where: {
        types: ["concept"],
        statuses: ["stable"],
        trustTiers: ["unverified"],
        conformance: ["strict"],
      },
    }).map((item) => item.suggestion)).toContain("seasonal planning");
  });

  it("returns public search-hit fields and applies structured search filters", () => {
    expect(handle.search("kiln loading", { limit: 8 })[0]).toMatchObject({
      documentId: "ceramics/kiln-loading",
      title: "Kiln Loading",
      sectionId: "ceramics/kiln-loading#kiln-loading",
      score: expect.any(Number),
      conformance: "strict",
      matchedFields: expect.arrayContaining(["title", "heading"]),
      headingPath: "Kiln Loading",
      path: "ceramics/kiln-loading.md",
      startLine: expect.any(Number),
      endLine: expect.any(Number),
      snippet: expect.any(String),
    });

    expect(handle.search("seasonal planning", {
      limit: 8,
      where: {
        types: ["concept"],
        statuses: ["stable"],
        trustTiers: ["unverified"],
        conformance: ["strict"],
      },
    }).map((hit) => hit.path)).toContain("gardens/seasonal-planning.md");
    expect(handle.search("kiln loading", {
      limit: 8,
      where: { types: ["plan"] },
    })).toEqual([]);
  });
});

describe("app option and upload boundaries", () => {
  it("maps every visible filter to exact public option keys", () => {
    const asOf = new Date("2026-08-24T12:00:00Z");

    expect(mapFilterOptions({
      types: ["concept", "plan"],
      tagsAny: " kiln, safety, kiln ",
      statuses: ["stable"],
      trustTiers: ["human-reviewed"],
      stale: "current",
      conformance: ["strict", "degraded"],
      asOf,
    })).toEqual({
      limit: 8,
      where: {
        types: ["concept", "plan"],
        tagsAny: ["kiln", "safety"],
        statuses: ["stable"],
        trustTiers: ["human-reviewed"],
        conformance: ["strict", "degraded"],
        stale: false,
      },
      asOf,
    });
    expect(mapFilterOptions({ stale: "stale" }).where).toEqual({ stale: true });
    expect(mapSearchOptions({
      types: ["concept"],
      tagsAny: "kiln",
      stale: "stale",
      asOf,
    })).toEqual({
      limit: 8,
      where: {
        types: ["concept"],
        tagsAny: ["kiln"],
        stale: true,
      },
      asOf,
    });
  });

  it("keeps suggestion and committed-search policy separate", () => {
    const filters = { statuses: ["stable"], asOf: "2026-08-24T12:00:00Z" };
    const suggestionOptions = mapFilterOptions(filters);
    const searchOptions = mapSearchOptions(filters);

    expect(suggestionOptions).toEqual({
      limit: 8,
      where: { statuses: ["stable"] },
      asOf: new Date("2026-08-24T12:00:00Z"),
    });
    expect(searchOptions).toEqual({
      limit: 8,
      where: { statuses: ["stable"] },
      asOf: new Date("2026-08-24T12:00:00Z"),
    });
    expect(searchOptions).not.toBe(suggestionOptions);
    expect(searchOptions.where).not.toBe(suggestionOptions.where);
  });

  it("resolves committed text without requiring suggestions", () => {
    expect(resolveCommittedQuery("  kiln raw phrase  ")).toBe("kiln raw phrase");
    expect(resolveCommittedQuery("ignored", { suggestion: "kiln loading load" }))
      .toBe("kiln loading load");
    expect(resolveCommittedQuery("   ")).toBe("");
    expect(resolveCommittedQuery(undefined, undefined)).toBe("");
  });

  it("recognizes both browser composition signals", () => {
    expect(isCompositionKey({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(isCompositionKey({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isCompositionKey({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it("omits empty arrays, empty where, and empty or invalid asOf", () => {
    for (const asOf of ["", "not-a-date", new Date(Number.NaN)]) {
      expect(mapFilterOptions({
        types: [],
        tagsAny: " , ",
        statuses: [],
        trustTiers: [],
        conformance: [],
        stale: "any",
        asOf,
      })).toEqual({ limit: 8 });
    }
  });

  it("assigns upload paths, decodes strict UTF-8, and validates decoded input", async () => {
    const markdown = "---\ntype: concept\ntitle: Upload\n---\n\n# Upload\n\nstrict upload needle\n";
    const bytes = new TextEncoder().encode(markdown);
    const file = {
      name: "note.md",
      arrayBuffer: async () => bytes.buffer,
    };
    const input = await readUpload(file);

    expect(uploadPath(file)).toBe("uploads/note.md");
    expect(input).toEqual({ path: "uploads/note.md", markdown });
    expect(validateOkfDocument(input)).toMatchObject({
      isValid: true,
      isIndexable: true,
    });
    expect(() => decodeUtf8(Uint8Array.from([0xc3, 0x28]))).toThrow();
    expect(validateOkfDocument({
      path: "uploads/broken.md",
      markdown: "---\ntype: [\n---\n",
    })).toMatchObject({ isValid: false, isIndexable: false });
  });
});

describe("committed search behavior", () => {
  it("resolves accepted suggestions and raw Enter without committing other keys", () => {
    const accepted = { suggestion: "  kiln loading load  " };

    expect(resolveSearchKeyAction(
      { key: "Enter" },
      "ignored raw query",
      accepted,
    )).toEqual({ type: "commit", query: "kiln loading load" });
    expect(resolveSearchKeyAction(
      { key: "Enter" },
      "  current raw query  ",
      undefined,
    )).toEqual({ type: "commit", query: "current raw query" });

    expect(resolveSearchKeyAction({ key: "Enter" }, "   ", undefined))
      .toEqual({ type: "ignore" });
    expect(resolveSearchKeyAction(
      { key: "Enter", isComposing: true },
      "kiln",
      accepted,
    )).toEqual({ type: "composition" });
    expect(resolveSearchKeyAction(
      { key: "Enter", keyCode: 229 },
      "kiln",
      accepted,
    )).toEqual({ type: "composition" });
    expect(resolveSearchKeyAction({ key: "Escape" }, "kiln", accepted))
      .toEqual({ type: "close" });
    expect(resolveSearchKeyAction({ key: "Tab" }, "kiln", accepted))
      .toEqual({ type: "ignore" });
  });

  it("calls search once per commit with current filters, asOf, and limit 8", () => {
    const calls: Array<{ query: string; options: unknown }> = [];
    const search = (query: string, options: unknown) => {
      calls.push({ query, options });
      return [];
    };
    const session = createCommittedSearchSession(search);
    const firstAsOf = new Date("2026-08-24T12:00:00Z");

    session.commit("  kiln loading  ", {
      types: ["concept"],
      stale: "current",
      asOf: firstAsOf,
    });
    expect(calls).toEqual([{
      query: "kiln loading",
      options: {
        limit: 8,
        where: { types: ["concept"], stale: false },
        asOf: firstAsOf,
      },
    }]);

    const secondAsOf = new Date("2026-08-25T09:30:00Z");
    session.commit("seasonal planning", {
      tagsAny: "garden, planning",
      statuses: ["stable"],
      asOf: secondAsOf,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({
      query: "seasonal planning",
      options: {
        limit: 8,
        where: {
          tagsAny: ["garden", "planning"],
          statuses: ["stable"],
        },
        asOf: secondAsOf,
      },
    });
  });

  it.each(["typing", "filter change", "corpus refresh"])(
    "%s invalidates prior results without searching",
    () => {
      let searchCalls = 0;
      const session = createCommittedSearchSession(() => {
        searchCalls += 1;
        return [{ title: "Prior result", path: "prior.md" }];
      });

      expect(session.commit("prior").status).toBe("ready");
      const callsBeforeInvalidation = searchCalls;
      expect(session.invalidate()).toEqual({
        status: "blank",
        message: "Search results appear after you choose a suggestion or press Enter.",
        query: "",
        hits: [],
      });
      expect(session.state.hits).toEqual([]);
      expect(searchCalls).toBe(callsBeforeInvalidation);
    },
  );

  it("formats valid line ranges and rejects malformed or absent values", () => {
    expect(toSearchResultText({ startLine: 12, endLine: 18 }).lineRange)
      .toBe("lines 12–18");
    expect(toSearchResultText({ startLine: 7, endLine: 7 }).lineRange)
      .toBe("line 7");

    for (const hit of [
      { startLine: 0, endLine: 2 },
      { startLine: 1, endLine: 0 },
      { startLine: 1.5, endLine: 2 },
      { startLine: 4, endLine: 3 },
      { startLine: 1, endLine: Number.NaN },
      {},
    ]) {
      expect(toSearchResultText(hit).lineRange).toBe("");
    }
  });

  it("replaces success, zero, and error outcomes with text-safe result data", () => {
    const unsafeHit = {
      title: "<img src=x onerror=alert(1)>",
      path: "<script>/path.md",
      headingPath: "<b>Unsafe heading</b>",
      snippet: "<em>snippet & text</em>",
      conformance: "<strict>",
      matchedFields: ["<title>", "heading&body"],
      score: 1.23456,
    };
    const session = createCommittedSearchSession((query: string) => {
      if (query === "zero") return [];
      if (query === "error") throw new Error("search unavailable");
      if (query === "unsafe") return [unsafeHit];
      return [{ title: "Prior", path: "prior.md", score: 0.5 }];
    });

    expect(session.commit("prior")).toMatchObject({
      status: "ready",
      hits: [{ title: "Prior", path: "prior.md" }],
    });
    expect(session.commit("unsafe")).toEqual({
      status: "ready",
      message: "1 document found for “unsafe”.",
      query: "unsafe",
      hits: [{
        title: "<img src=x onerror=alert(1)>",
        path: "<script>/path.md",
        headingPath: "<b>Unsafe heading</b>",
        snippet: "<em>snippet & text</em>",
        conformance: "<strict>",
        lineRange: "",
        matchedFields: ["<title>", "heading&body"],
        score: "1.235",
      }],
    });
    expect(session.commit("zero")).toEqual({
      status: "empty",
      message: "No documents found for “zero”. Try a broader phrase or adjust the filters.",
      query: "zero",
      hits: [],
    });
    expect(session.commit("error")).toEqual({
      status: "error",
      message: "Search failed for “error”. Check the filters and try again.",
      query: "error",
      hits: [],
    });
  });
});

describe("combobox keyboard state", () => {
  it("owns navigation, wrapping, and Escape closure without a DOM", () => {
    let state = { activeIndex: -1, open: false };
    state = transitionCombobox(state, "ArrowDown", 3);
    expect(state).toEqual({ activeIndex: 0, open: true });
    state = transitionCombobox(state, "ArrowUp", 3);
    expect(state).toEqual({ activeIndex: 2, open: true });
    state = transitionCombobox(state, "Home", 3);
    expect(state).toEqual({ activeIndex: 0, open: true });
    state = transitionCombobox(state, "End", 3);
    expect(state).toEqual({ activeIndex: 2, open: true });
    state = transitionCombobox(state, "ArrowDown", 3);
    expect(state).toEqual({ activeIndex: 0, open: true });
    state = transitionCombobox(state, "Escape", 3);
    expect(state).toEqual({ activeIndex: -1, open: false });
    expect(transitionCombobox(state, "Tab", 3)).toEqual(state);
    expect(transitionCombobox({ activeIndex: 0, open: true }, "ArrowDown", 0))
      .toEqual({ activeIndex: -1, open: false });
  });
});

async function markdownPaths(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const next = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) return markdownPaths(root, next);
    return entry.isFile() && entry.name.endsWith(".md") ? [next] : [];
  }));
  return paths.flat();
}
