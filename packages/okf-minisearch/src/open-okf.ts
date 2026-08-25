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
  const recordIds = new Map(
    prepared.map((result) => [
      result.document.id,
      result.records.map((record) => record.id),
    ]),
  );

  addRecords(index, records);

  return {
    ingest(input): OkfIngestResult {
      const result = prepareDocument(input);
      const previousIds = recordIds.get(
        result.document.id,
      );

      if (previousIds?.length) {
        index.discardAll(previousIds);
      }

      addRecords(index, result.records);
      recordIds.set(
        result.document.id,
        result.records.map((record) => record.id),
      );

      return { document: result.document };
    },

    remove(path) {
      const { documentId } = normalizeDocumentIdentity(path);
      const ids = recordIds.get(documentId);

      if (ids === undefined) {
        return false;
      }

      assertOwnedRecordIds(index, documentId, ids);
      index.discardAll(ids);
      recordIds.delete(documentId);
      return true;
    },

    search(query, options) {
      return search(index, query, options);
    },
  };
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
  index.addAll(records.map((record) => ({
    ...record,
    tags: [...record.tags],
  })));
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
