// These types remain internal to the package implementation and must not be
// importable from the supported package root.
// @ts-expect-error OkfBundle is not part of the package root API.
import type { OkfBundle } from "../src/index.js";
// @ts-expect-error OkfReservedFile is not part of the package root API.
import type { OkfReservedFile } from "../src/index.js";

void (undefined as unknown as OkfBundle | OkfReservedFile);
