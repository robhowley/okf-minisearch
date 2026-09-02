import type { OkfErrorCode } from "./types.js";

interface OkfErrorOptions {
  readonly field?: string;
  readonly cause?: unknown;
}

export class OkfError extends Error {
  readonly code: OkfErrorCode;
  readonly path: string;
  declare readonly field?: string;

  constructor(
    code: OkfErrorCode,
    path: string,
    options: OkfErrorOptions = {},
  ) {
    super(
      message(code, path, options.field),
      options.cause === undefined ? undefined : { cause: options.cause },
    );

    this.name = "OkfError";
    this.code = code;
    this.path = path;

    if (options.field !== undefined) {
      this.field = options.field;
    }
  }
}

function message(
  code: OkfErrorCode,
  path: string,
  field: string | undefined,
): string {
  const subject = field ? `${path} (${field})` : path;

  switch (code) {
    case "ERR_OKF_READ":
      return `Cannot read OKF path: ${subject}`;
    case "ERR_OKF_PARSE":
      return `Cannot parse OKF concept: ${subject}`;
    case "ERR_OKF_FIELD":
      return `Invalid OKF field: ${subject}`;
    case "ERR_OKF_INDEX_UNUSABLE":
      return path === "<index>"
        ? "Search index is permanently unusable and must be rebuilt"
        : `Search index failed while mutating ${path}; this OkfSearch handle is permanently unusable and must be rebuilt`;
    case "ERR_OKF_UNSUPPORTED":
      return `Unsupported OKF operation: ${path}`;
  }
}
