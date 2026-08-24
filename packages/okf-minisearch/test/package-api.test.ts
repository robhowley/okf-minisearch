import {
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";

import * as api from "../src/index.js";
import type {
  OkfDocumentInput,
  OkfIngestResult,
  OkfSearch,
  OkfSearchHit,
  OkfSearchOptions,
} from "../src/index.js";

describe("package API", () => {
  it("exports the runtime boundary", () => {
    expect(Object.keys(api).sort()).toEqual([
      "OkfError",
      "openOkf",
    ]);
  });

  it("keeps generated-declaration source types usable", () => {
    expectTypeOf(api.openOkf).returns.resolves.toMatchTypeOf<OkfSearch>();
    expectTypeOf<OkfSearch["ingest"]>()
      .parameter(0)
      .toEqualTypeOf<OkfDocumentInput>();
    expectTypeOf<OkfSearch["ingest"]>()
      .returns
      .toEqualTypeOf<OkfIngestResult>();
    expectTypeOf<OkfSearch["search"]>()
      .parameter(1)
      .toEqualTypeOf<OkfSearchOptions | undefined>();
    expectTypeOf<OkfSearch["search"]>()
      .returns
      .toEqualTypeOf<OkfSearchHit[]>();
  });
});
