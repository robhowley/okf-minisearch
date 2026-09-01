import { PrepareError } from "./errors.js";

import type { OkfDocumentIdentity } from "./types.js";

export function normalizeOkfDocumentIdentity(
  path: string,
): OkfDocumentIdentity {
  const normalizedPath = normalizePath(path);

  return {
    path: normalizedPath,
    documentId: documentId(normalizedPath),
  };
}

function normalizePath(path: string): string {
  if (
    !path
    || path.startsWith("/")
    || /^[A-Za-z]:/.test(path)
    || path.startsWith("\\\\")
    || path.endsWith("/")
    || path.endsWith("/.")
  ) {
    throw invalidUnsafePath();
  }

  const segments = path.split("/");
  if (segments.includes("..")) {
    throw invalidUnsafePath();
  }

  const normalized = segments
    .filter((segment) => segment && segment !== ".")
    .join("/");
  if (!normalized) {
    throw invalidUnsafePath();
  }

  return normalized;
}

function invalidUnsafePath(): PrepareError {
  return new PrepareError("ERR_OKF_FIELD", "<input>", { field: "path" });
}

function documentId(path: string): string {
  const filename = path.split("/").at(-1);
  if (
    !filename?.endsWith(".md")
    || filename === "index.md"
    || filename === "log.md"
  ) {
    throw new PrepareError("ERR_OKF_FIELD", path, { field: "path" });
  }

  return path.slice(0, -3);
}
