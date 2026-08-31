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

import { createOkfSearch } from "./create-okf-search.js";
import { OkfError } from "./errors.js";

import type { OkfDocumentInput, OkfSearch } from "./types.js";

interface ConceptFile {
  absolutePath: string;
  relativePath: string;
}

export async function openOkf(
  root: string,
): Promise<OkfSearch> {
  const bundleRoot = resolve(root);
  const files = await findConceptFiles(bundleRoot, bundleRoot);
  const documents: OkfDocumentInput[] = [];

  for (const file of files) {
    documents.push({
      path: file.relativePath,
      markdown: await readConcept(file),
    });
  }

  return createOkfSearch(documents);
}

async function readConcept(file: ConceptFile): Promise<string> {
  let contents: Uint8Array;

  try {
    contents = await readFile(file.absolutePath);
  } catch (cause) {
    throw new OkfError("ERR_OKF_READ", file.relativePath, { cause });
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch (cause) {
    throw new OkfError("ERR_OKF_PARSE", file.relativePath, { cause });
  }
}

async function findConceptFiles(
  root: string,
  directory: string,
): Promise<ConceptFile[]> {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
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
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await findConceptFiles(root, absolutePath));
    } else if (entry.isFile() && isConceptFile(entry.name)) {
      files.push({
        absolutePath,
        relativePath: relativePath(root, absolutePath),
      });
    }
  }

  return files.sort((left, right) =>
    comparePaths(left.relativePath, right.relativePath));
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function relativePath(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  return value || ".";
}

function isConceptFile(filename: string): boolean {
  return filename.endsWith(".md") &&
    filename !== "index.md" &&
    filename !== "log.md";
}
