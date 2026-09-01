export type PrepareErrorCode =
  | "ERR_OKF_READ"
  | "ERR_OKF_PARSE"
  | "ERR_OKF_FIELD";

export interface PrepareErrorOptions {
  readonly field?: string;
  readonly cause?: unknown;
}

export class PrepareError extends Error {
  readonly code: PrepareErrorCode;
  readonly path: string;
  declare readonly field?: string;

  constructor(
    code: PrepareErrorCode,
    path: string,
    options: PrepareErrorOptions = {},
  ) {
    super(
      message(code, path, options.field),
      options.cause === undefined
        ? undefined
        : { cause: options.cause },
    );

    this.name = "PrepareError";
    this.code = code;
    this.path = path;

    if (options.field !== undefined) {
      this.field = options.field;
    }
  }
}

function message(
  code: PrepareErrorCode,
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
