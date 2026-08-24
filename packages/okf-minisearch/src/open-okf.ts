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

import {
  ingestDocument,
} from "./ingest.js";

import {
  search,
} from "./search.js";

import type {
  OkfIndexRecord,
  OkfSearch,
} from "./types.js";

export async function openOkf(
  root: string,
): Promise<OkfSearch> {
  const bundleRoot = resolve(root);
  const index = createIndex();

  for (
    const file of
      await findConceptFiles(bundleRoot)
  ) {
    ingestDocument(index, {
      path: relative(bundleRoot, file)
        .split(sep)
        .join("/"),

      markdown: await readFile(
        file,
        "utf8",
      ),
    });
  }

  return {
    ingest(input) {
      return ingestDocument(
        index,
        input,
      );
    },

    search(query, options) {
      return search(
        index,
        query,
        options,
      );
    },
  };
}

function createIndex():
  MiniSearch<OkfIndexRecord> {
  return new MiniSearch<OkfIndexRecord>({
    fields: [
      "documentId",
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
      "type",
      "tags",
      "status",
      "staleAfter",
      "trustTier",
      "headingPath",
      "text",
      "startLine",
      "endLine",
    ],
  });
}

async function findConceptFiles(
  directory: string,
): Promise<string[]> {
  const files: string[] = [];

  const entries = await readdir(
    directory,
    {
      withFileTypes: true,
    },
  );

  for (const entry of entries) {
    const path = join(
      directory,
      entry.name,
    );

    if (entry.isDirectory()) {
      files.push(
        ...await findConceptFiles(path),
      );
    } else if (
      entry.isFile() &&
      isConceptFile(entry.name)
    ) {
      files.push(path);
    }
  }

  return files.sort();
}

function isConceptFile(
  filename: string,
): boolean {
  const name = filename.toLowerCase();

  return (
    name.endsWith(".md") &&
    name !== "index.md" &&
    name !== "log.md"
  );
}