import {
  afterEach,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";

import * as api from "../src/index.js";
import type {
  IsoDateTime,
  OkfAttester,
  OkfDiagnostic,
  OkfDiagnosticCode,
  OkfDocument,
  OkfDocumentInput,
  OkfErrorCode,
  OkfExecutor,
  OkfGeneration,
  OkfIngestResult,
  OkfParameter,
  OkfSearch,
  OkfSearchField,
  OkfSearchHit,
  OkfSearchOptions,
  OkfSource,
  OkfStatus,
  OkfTimeWindow,
  OkfTrustTier,
  OkfValidationResult,
  OkfVerification,
} from "../src/index.js";
import {
  concept,
  createBundle,
  type TestBundle,
} from "./support/bundle.js";

const bundles: TestBundle[] = [];

afterEach(async () => {
  await Promise.all(
    bundles.splice(0).map((bundle) =>
      bundle.cleanup()),
  );
});

describe("package API", () => {
  it("exports the runtime boundary", () => {
    expect(Object.keys(api).sort()).toEqual([
      "OkfError",
      "openOkf",
      "validateOkfDocument",
    ]);
  });

  it("opens, ingests, and searches through the package root", async () => {
    const tree = await createBundle({});
    bundles.push(tree);

    expect(api.OkfError).toBeTypeOf("function");
    expect(api.validateOkfDocument({
      path: "package-api.md",
      markdown: concept("type: note"),
    })).toEqual({
      isValid: true,
      errors: [],
    });

    const okf = await api.openOkf(tree.root);

    expect(okf.ingest).toBeTypeOf("function");
    expect(okf.remove).toBeTypeOf("function");
    expect(okf.search).toBeTypeOf("function");

    const result = okf.ingest({
      path: "package-api.md",
      markdown: concept(
        "type: note",
        "packageboundaryneedle",
      ),
    });
    const hits = okf.search("packageboundaryneedle");

    expect(result.document.id).toBe("package-api");
    expect(result.document.status).toBe("stable");
    expect(Object.keys(result)).toEqual(["document"]);
    expect(Object.hasOwn(result, "records")).toBe(false);
    expect(Object.hasOwn(result, "diagnostics")).toBe(false);
    expect(hits).toEqual([
      expect.objectContaining({
        documentId: "package-api",
        path: "package-api.md",
      }),
    ]);
    expectTypeOf(result).toEqualTypeOf<OkfIngestResult>();
    expectTypeOf(hits).toEqualTypeOf<OkfSearchHit[]>();
  });

  it("exports OkfError with its supported error code", () => {
    const error = new api.OkfError(
      "ERR_OKF_FIELD",
      "package-api.md",
      { field: "path" },
    );
    const code: OkfErrorCode = error.code;

    expect(error).toBeInstanceOf(api.OkfError);
    expect(error).toMatchObject({
      code,
      path: "package-api.md",
      field: "path",
    });
  });

  it("keeps supported public and transitive types importable", () => {
    const isoDateTime: IsoDateTime =
      "2026-08-24T10:00:00Z";
    const status = "stable" as OkfStatus;
    const timeWindow: OkfTimeWindow = {
      from: isoDateTime,
      to: isoDateTime,
    };
    const source: OkfSource = {
      resource: "source.md",
      usageWindow: timeWindow,
    };
    const generation: OkfGeneration = {
      by: "process:builder",
      at: isoDateTime,
    };
    const verification: OkfVerification = {
      by: "human:reviewer",
      at: isoDateTime,
    };
    const parameter: OkfParameter = {
      name: "input",
      type: "string",
      required: true,
    };
    const executor: OkfExecutor = {
      resource: "executor",
      receipt: ["receipt"],
    };
    const attester: OkfAttester = {
      resource: "attester",
    };
    const document: OkfDocument = {
      id: "package-api",
      type: "note",
      title: "Package API",
      tags: ["public"],
      sources: [source],
      usageWindow: timeWindow,
      generated: generation,
      verified: [verification],
      status,
      staleAfter: isoDateTime,
      runtime: "node",
      parameters: [parameter],
      computation: "test",
      executor,
      attester,
      body: "body",
      extensions: {},
    };
    const diagnosticCode: OkfDiagnosticCode = "ERR_OKF_FIELD";
    const diagnostic: OkfDiagnostic = {
      code: diagnosticCode,
      path: "package-api.md",
      field: "status",
      message: "diagnostic",
    };
    const validationResult: OkfValidationResult = {
      isValid: false,
      errors: [diagnostic],
    };

    expectTypeOf(isoDateTime).toEqualTypeOf<IsoDateTime>();
    expectTypeOf<OkfStatus>().toEqualTypeOf<
      "draft" | "stable" | "deprecated"
    >();
    expectTypeOf<OkfTrustTier>().toEqualTypeOf<
      "unverified" | "machine-confirmed" | "human-reviewed"
    >();
    expectTypeOf(timeWindow).toEqualTypeOf<OkfTimeWindow>();
    expectTypeOf(source).toEqualTypeOf<OkfSource>();
    expectTypeOf(generation).toEqualTypeOf<OkfGeneration>();
    expectTypeOf(verification).toEqualTypeOf<OkfVerification>();
    expectTypeOf(parameter).toEqualTypeOf<OkfParameter>();
    expectTypeOf(executor).toEqualTypeOf<OkfExecutor>();
    expectTypeOf(attester).toEqualTypeOf<OkfAttester>();
    expectTypeOf(document).toEqualTypeOf<OkfDocument>();
    expectTypeOf<OkfDocument["status"]>().toEqualTypeOf<OkfStatus>();
    expectTypeOf<OkfIngestResult>().toEqualTypeOf<{
      document: OkfDocument;
    }>();
    expectTypeOf<OkfDiagnosticCode>().toEqualTypeOf<
      "ERR_OKF_PARSE" | "ERR_OKF_FIELD"
    >();
    expectTypeOf(diagnostic).toEqualTypeOf<OkfDiagnostic>();
    expectTypeOf(validationResult).toEqualTypeOf<OkfValidationResult>();
    expectTypeOf<OkfValidationResult>().toEqualTypeOf<{
      readonly isValid: boolean;
      readonly errors: readonly OkfDiagnostic[];
    }>();
  });

  it("exports the exact search controls contract", () => {
    const fields = ["heading", "body"] as const;
    const options: OkfSearchOptions = {
      match: "all",
      fields,
      fuzzy: true,
    };

    expectTypeOf<OkfSearchField>().toEqualTypeOf<
      | "resource"
      | "title"
      | "heading"
      | "description"
      | "tags"
      | "type"
      | "sources"
      | "body"
    >();
    expectTypeOf<OkfSearchOptions["fields"]>()
      .toEqualTypeOf<
        readonly OkfSearchField[] | undefined
      >();
    expectTypeOf<OkfSearchOptions["fuzzy"]>()
      .toEqualTypeOf<boolean | undefined>();
    expectTypeOf<OkfSearchHit["matchedFields"]>()
      .toEqualTypeOf<OkfSearchField[]>();
    expectTypeOf<OkfSearchHit["title"]>()
      .toEqualTypeOf<string>();
    expect(options).toMatchObject({
      match: "all",
      fields,
      fuzzy: true,
    });
  });

  it("keeps generated-declaration source types usable", () => {
    expectTypeOf(api.validateOkfDocument)
      .parameter(0)
      .toEqualTypeOf<OkfDocumentInput>();
    expectTypeOf(api.validateOkfDocument)
      .returns
      .toEqualTypeOf<OkfValidationResult>();
    expectTypeOf(api.openOkf).returns.resolves.toMatchTypeOf<OkfSearch>();
    expectTypeOf<OkfSearch["ingest"]>()
      .parameter(0)
      .toEqualTypeOf<OkfDocumentInput>();
    expectTypeOf<OkfSearch["ingest"]>()
      .returns
      .toEqualTypeOf<OkfIngestResult>();
    expectTypeOf<OkfSearch["remove"]>()
      .toEqualTypeOf<(path: string) => boolean>();
    expectTypeOf<OkfSearch["search"]>()
      .parameter(1)
      .toEqualTypeOf<OkfSearchOptions | undefined>();
    expectTypeOf<OkfSearch["search"]>()
      .returns
      .toEqualTypeOf<OkfSearchHit[]>();
  });
});
