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

import { PrepareError } from "./errors.js";
import { normalizeOkfDocumentIdentity } from "./identity.js";

import type {
  OkfDocumentIdentity,
  OkfDocumentInput,
} from "./types.js";

interface Candidate {
  readonly absolutePath: string;
  readonly relativePath: string;
}

interface NormalizedCandidate {
  readonly absolutePath: string;
  readonly identity: OkfDocumentIdentity;
}

export async function readOkfDocuments(
  root: string,
): Promise<readonly OkfDocumentInput[]> {
  const bundleRoot = resolve(root);
  const candidates = await findCandidates(bundleRoot, bundleRoot);
  const normalizedCandidates = candidates.map((candidate) => ({
    absolutePath: candidate.absolutePath,
    identity: normalizeOkfDocumentIdentity(candidate.relativePath),
  }));

  normalizedCandidates.sort((left, right) =>
    comparePaths(left.identity.path, right.identity.path));

  const seenDocumentIds = new Set<string>();
  for (const candidate of normalizedCandidates) {
    if (seenDocumentIds.has(candidate.identity.documentId)) {
      throw new PrepareError(
        "ERR_OKF_FIELD",
        candidate.identity.path,
        { field: "path" },
      );
    }
    seenDocumentIds.add(candidate.identity.documentId);
  }

  const documents: OkfDocumentInput[] = [];
  for (const candidate of normalizedCandidates) {
    let contents: Uint8Array;

    try {
      contents = await readFile(candidate.absolutePath);
    } catch (cause) {
      throw new PrepareError(
        "ERR_OKF_READ",
        candidate.identity.path,
        { cause },
      );
    }

    try {
      const markdown = new TextDecoder("utf-8", { fatal: true })
        .decode(contents);
      documents.push({
        path: candidate.identity.path,
        markdown,
      });
    } catch (cause) {
      throw new PrepareError(
        "ERR_OKF_PARSE",
        candidate.identity.path,
        { cause },
      );
    }
  }

  return documents;
}

async function findCandidates(
  root: string,
  directory: string,
): Promise<Candidate[]> {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    throw new PrepareError(
      "ERR_OKF_READ",
      relativePath(root, directory),
      { cause },
    );
  }

  const candidates: Candidate[] = [];
  for (const entry of entries.slice().sort((left, right) =>
    comparePaths(left.name, right.name))) {
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      candidates.push(...await findCandidates(root, absolutePath));
    } else if (entry.isFile() && isOkfDocumentFile(entry.name)) {
      candidates.push({
        absolutePath,
        relativePath: relativePath(root, absolutePath),
      });
    }
  }

  return candidates.sort((left, right) =>
    comparePaths(left.relativePath, right.relativePath));
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function relativePath(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  return value || ".";
}

function isOkfDocumentFile(filename: string): boolean {
  return filename.endsWith(".md") &&
    filename !== "index.md" &&
    filename !== "log.md";
}
