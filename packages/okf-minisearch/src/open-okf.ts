import {
  readdir,
  readFile,
} from "node:fs/promises";

import {
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import MiniSearch from "minisearch";

import { OkfError } from "./errors.js";
import {
  normalizeDocumentIdentity,
  prepareDocument,
} from "./ingest.js";
import { search } from "./search.js";

import type {
  OkfIngestResult,
  OkfSearch,
} from "./types.js";
import type {
  OkfIndexRecord,
  OkfPreparedDocument,
} from "./internal-types.js";

interface ConceptFile {
  absolutePath: string;
  relativePath: string;
}

interface IndexedDocumentState {
  readonly recordIds: readonly string[];
  readonly type: string;
}

export async function openOkf(
  root: string,
): Promise<OkfSearch> {
  const bundleRoot = resolve(root);
  const files = await findConceptFiles(
    bundleRoot,
    bundleRoot,
  );
  const prepared: OkfPreparedDocument[] = [];

  for (const file of files) {
    prepared.push(
      prepareDocument({
        path: file.relativePath,
        markdown: await readConcept(file),
      }),
    );
  }

  const index = createIndex();
  const records = prepared.flatMap(
    (result) => [...result.records],
  );

  addRecords(index, records);

  const recordIds = new Map<string, IndexedDocumentState>();
  const typeCounts = new Map<string, number>();
  for (const result of prepared) {
    recordIds.set(result.document.id, {
      recordIds: result.records.map((record) => record.id),
      type: result.document.type,
    });
    updateTypeCount(typeCounts, result.document.type, 1);
  }
  let typeSnapshot = createTypeSnapshot(typeCounts);

  let unusableError: OkfError | undefined;

  const assertUsable = (): void => {
    if (unusableError) {
      throw unusableError;
    }
  };

  const poison = (
    path: string,
    cause: unknown,
  ): never => {
    const error = new OkfError(
      "ERR_OKF_INDEX_UNUSABLE",
      path,
      { cause },
    );
    unusableError = error;
    throw error;
  };

  return {
    ingest(input): OkfIngestResult {
      assertUsable();
      const result = prepareDocument(input);
      const indexedRecords = cloneRecords(result.records);
      const path = result.records[0]?.path ?? `${result.document.id}.md`;
      const previous = recordIds.get(
        result.document.id,
      );

      if (previous?.recordIds.length) {
        try {
          index.discardAll(previous.recordIds);
        } catch (cause) {
          poison(path, cause);
        }
      }

      try {
        index.addAll(indexedRecords);
      } catch (cause) {
        poison(path, cause);
      }

      recordIds.set(result.document.id, {
        recordIds: result.records.map((record) => record.id),
        type: result.document.type,
      });
      let typesChanged = false;
      if (!previous) {
        typesChanged = updateTypeCount(
          typeCounts,
          result.document.type,
          1,
        );
      } else if (previous.type !== result.document.type) {
        typesChanged = updateTypeCount(
          typeCounts,
          previous.type,
          -1,
        );
        typesChanged = updateTypeCount(
          typeCounts,
          result.document.type,
          1,
        ) || typesChanged;
      }
      if (typesChanged) {
        typeSnapshot = createTypeSnapshot(typeCounts);
      }

      return { document: result.document };
    },

    listTypes() {
      assertUsable();
      return typeSnapshot;
    },

    remove(path) {
      assertUsable();
      const identity = normalizeDocumentIdentity(path);
      const state = recordIds.get(identity.documentId);

      if (state === undefined) {
        return false;
      }

      assertOwnedRecordIds(index, identity.documentId, state.recordIds);
      try {
        index.discardAll(state.recordIds);
      } catch (cause) {
        poison(identity.path, cause);
      }
      recordIds.delete(identity.documentId);
      if (updateTypeCount(typeCounts, state.type, -1)) {
        typeSnapshot = createTypeSnapshot(typeCounts);
      }
      return true;
    },

    search(query, options) {
      assertUsable();
      return search(index, query, options);
    },
  };
}

function updateTypeCount(
  typeCounts: Map<string, number>,
  type: string,
  delta: 1 | -1,
): boolean {
  const current = typeCounts.get(type) ?? 0;
  const next = current + delta;

  if (next === 0) {
    typeCounts.delete(type);
  } else {
    typeCounts.set(type, next);
  }

  return current === 0 || next === 0;
}

function createTypeSnapshot(
  typeCounts: ReadonlyMap<string, number>,
): readonly string[] {
  return Object.freeze(
    [...typeCounts.keys()].sort(comparePaths),
  );
}

function assertOwnedRecordIds(
  index: MiniSearch<OkfIndexRecord>,
  documentId: string,
  ids: readonly string[],
): void {
  if (
    ids.length === 0 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !index.has(id))
  ) {
    throw new Error(
      `OKF index ownership is inconsistent for ${documentId}`,
    );
  }
}

function addRecords(
  index: MiniSearch<OkfIndexRecord>,
  records: readonly OkfIndexRecord[],
): void {
  index.addAll(cloneRecords(records));
}

function cloneRecords(
  records: readonly OkfIndexRecord[],
): OkfIndexRecord[] {
  return records.map((record) => ({
    ...record,
    tags: [...record.tags],
  }));
}

function createIndex():
  MiniSearch<OkfIndexRecord> {
  return new MiniSearch<OkfIndexRecord>({
    fields: [
      "resource",
      "title",
      "headingPath",
      "description",
      "tags",
      "type",
      "sourceText",
      "text",
    ],

    storeFields: [
      "documentId",
      "title",
      "path",
      "type",
      "tags",
      "status",
      "staleAfter",
      "staleAfterEpoch",
      "stalenessClassified",
      "trustTier",
      "headingPath",
      "text",
      "startLine",
      "endLine",
    ],
  });
}

async function readConcept(
  file: ConceptFile,
): Promise<string> {
  let contents: Uint8Array;

  try {
    contents = await readFile(
      file.absolutePath,
    );
  } catch (cause) {
    throw new OkfError(
      "ERR_OKF_READ",
      file.relativePath,
      { cause },
    );
  }

  try {
    return new TextDecoder(
      "utf-8",
      { fatal: true },
    ).decode(contents);
  } catch (cause) {
    throw new OkfError(
      "ERR_OKF_PARSE",
      file.relativePath,
      { cause },
    );
  }
}

async function findConceptFiles(
  root: string,
  directory: string,
): Promise<ConceptFile[]> {
  let entries;

  try {
    entries = await readdir(
      directory,
      { withFileTypes: true },
    );
  } catch (cause) {
    throw new OkfError(
      "ERR_OKF_READ",
      relativePath(root, directory),
      { cause },
    );
  }

  const files: ConceptFile[] = [];

  for (const entry of entries.sort((left, right) =>
    comparePaths(left.name, right.name))) {
    const absolutePath = join(
      directory,
      entry.name,
    );

    if (entry.isDirectory()) {
      files.push(
        ...await findConceptFiles(
          root,
          absolutePath,
        ),
      );
    } else if (
      entry.isFile() &&
      isConceptFile(entry.name)
    ) {
      files.push({
        absolutePath,
        relativePath: relativePath(
          root,
          absolutePath,
        ),
      });
    }
  }

  return files.sort((left, right) =>
    comparePaths(
      left.relativePath,
      right.relativePath,
    ));
}

function comparePaths(
  left: string,
  right: string,
): number {
  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

function relativePath(
  root: string,
  path: string,
): string {
  const value = relative(root, path)
    .split(sep)
    .join("/");

  return value || ".";
}

function isConceptFile(
  filename: string,
): boolean {
  return filename.endsWith(".md") &&
    filename !== "index.md" &&
    filename !== "log.md";
}
