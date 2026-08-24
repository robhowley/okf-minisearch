export type OkfErrorCode =
  | "ERR_OKF_READ"
  | "ERR_OKF_PARSE"
  | "ERR_OKF_FIELD";

export interface OkfErrorOptions {
  field?: string;
  cause?: unknown;
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
      options.cause === undefined
        ? undefined
        : { cause: options.cause },
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
  const subject = field
    ? `${path} (${field})`
    : path;

  switch (code) {
    case "ERR_OKF_READ":
      return `Cannot read OKF path: ${subject}`;
    case "ERR_OKF_PARSE":
      return `Cannot parse OKF concept: ${subject}`;
    case "ERR_OKF_FIELD":
      return `Invalid OKF field: ${subject}`;
  }
}
