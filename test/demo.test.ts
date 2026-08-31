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
  decodeUtf8,
  mapFilterOptions,
  readUpload,
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
    expect(app).not.toContain(".search(");
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
