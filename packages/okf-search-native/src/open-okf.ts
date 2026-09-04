import { PrepareError } from "@okf-internal/prepare";
import { readOkfDocuments } from "@okf-internal/prepare/node";

import { createOkfSearch } from "./create-okf-search.js";
import { OkfError } from "./errors.js";

import type { OkfSearch } from "./types.js";

export async function openOkf(root: string): Promise<OkfSearch> {
  try {
    return createOkfSearch(await readOkfDocuments(root));
  } catch (error) {
    if (error instanceof PrepareError) {
      throw new OkfError(error.code, error.path, {
        ...(error.field === undefined ? {} : { field: error.field }),
        ...(error.cause === undefined ? {} : { cause: error.cause }),
      });
    }

    throw error;
  }
}
