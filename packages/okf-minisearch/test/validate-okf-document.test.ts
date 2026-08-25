import {
  describe,
  expect,
  it,
} from "vitest";

import {
  openOkf,
  validateOkfDocument,
} from "../src/index.js";
import type {
  OkfDiagnostic,
  OkfDiagnosticCode,
} from "../src/index.js";
import {
  concept,
  createBundle,
} from "./support/bundle.js";

function validate(frontmatter: string, body = "body") {
  return validateOkfDocument({
    path: "concept.md",
    markdown: concept(frontmatter, body),
  });
}

function fields(frontmatter: string): Array<string | undefined> {
  return validate(frontmatter).errors.map((item) => item.field);
}

describe("validateOkfDocument", () => {
  it("accepts a type-only document through the package root", () => {
    expect(validate("type: unfamiliar")).toEqual({
      isValid: true,
      errors: [],
    });
    expect(validateOkfDocument).toBeTypeOf("function");
  });

  it.each([
    ["unsafe path", { path: "../secret.md", markdown: concept("type: note") }, "ERR_OKF_FIELD", "<input>", "path"],
    ["extension", { path: "./notes.MD", markdown: concept("type: note") }, "ERR_OKF_FIELD", "notes.MD", "path"],
    ["reserved", { path: "./nested//index.md", markdown: concept("type: note") }, "ERR_OKF_FIELD", "nested/index.md", "path"],
    ["frontmatter", { path: "./concept.md", markdown: "type: note" }, "ERR_OKF_PARSE", "concept.md", undefined],
    ["unclosed frontmatter", { path: "concept.md", markdown: "---\ntype: note" }, "ERR_OKF_PARSE", "concept.md", undefined],
    ["YAML", { path: "concept.md", markdown: "---\ntype: [\n---\n" }, "ERR_OKF_PARSE", "concept.md", undefined],
    ["root", { path: "concept.md", markdown: "---\nscalar\n---\n" }, "ERR_OKF_PARSE", "concept.md", undefined],
    ["missing type", { path: "concept.md", markdown: concept("title: x") }, "ERR_OKF_FIELD", "concept.md", "type"],
    ["blank type", { path: "concept.md", markdown: concept("type: '   '") }, "ERR_OKF_FIELD", "concept.md", "type"],
  ])("returns, rather than throws, for %s failures", (_name, input, code, path, field) => {
    expect(() => validateOkfDocument(input)).not.toThrow();
    const result = validateOkfDocument(input);
    expect(result).toEqual({
      isValid: false,
      errors: [
        expect.objectContaining({
          code,
          path,
          ...(field ? { field } : {}),
        }),
      ],
    });
    expect(result.errors[0]!.message).toBe(
      field
        ? `Invalid OKF field: ${path} (${field})`
        : `Cannot parse OKF concept: ${path}`,
    );
    if (path === "<input>") {
      expect(result.errors[0]!.message).not.toContain(input.path);
    }
  });

  it.each([
    [undefined, true],
    ["draft", true],
    ["stable", true],
    ["deprecated", true],
    ["future", false],
    ["Stable", false],
    ["", false],
    [null, false],
    [1, false],
    [[], false],
    [{}, false],
  ])("enforces exact status value %j", (status, accepted) => {
    const statusYaml = status === undefined
      ? ""
      : `\nstatus: ${JSON.stringify(status)}`;
    expect(validate(`type: note${statusYaml}`).errors).toHaveLength(accepted ? 0 : 1);
    if (!accepted) expect(fields(`type: note${statusYaml}`)).toEqual(["status"]);
  });

  it.each([
    ["title", "type: note\ntitle: {}", ["title"]],
    ["description", "type: note\ndescription: []", ["description"]],
    ["resource", "type: note\nresource: false", ["resource"]],
    ["tags aggregate", "type: note\ntags: nope", ["tags"]],
    ["tags member", "type: note\ntags: [ok, 1, false]", ["tags[1]", "tags[2]"]],
    ["sources aggregate", "type: note\nsources: nope", ["sources"]],
    ["source member", "type: note\nsources: [nope]", ["sources[0]"]],
    ["source children", "type: note\nsources:\n  - id: 1\n    title: false\n    author: 'human:'\n    usage_count: many\n    last_modified: yesterday\n    usage_window: {}", ["sources[0].resource", "sources[0].id", "sources[0].title", "sources[0].author", "sources[0].usage_count", "sources[0].last_modified", "sources[0].usage_window.from", "sources[0].usage_window.to"]],
    ["source window aggregate", "type: note\nsources:\n  - resource: x\n    usage_window: nope", ["sources[0].usage_window"]],
    ["usage window", "type: note\nusage_window: {}", ["usage_window.from", "usage_window.to"]],
    ["generated aggregate", "type: note\ngenerated: []", ["generated"]],
    ["generated children", "type: note\ngenerated:\n  by: bad actor\n  at: today", ["generated.by", "generated.at"]],
    ["verified aggregate", "type: note\nverified: nope", ["verified"]],
    ["verified member", "type: note\nverified: [nope]", ["verified[0]"]],
    ["verified children", "type: note\nverified: [{}]", ["verified[0].by", "verified[0].at"]],
    ["stale after", "type: note\nstale_after: yesterday", ["stale_after"]],
    ["runtime", "type: note\nruntime: 1", ["runtime"]],
    ["parameters aggregate", "type: note\nparameters: nope", ["parameters"]],
    ["parameter member", "type: note\nparameters: [nope]", ["parameters[0]"]],
    ["parameter children", "type: note\nparameters: [{}]", ["parameters[0].name", "parameters[0].type", "parameters[0].required"]],
    ["computation", "type: note\ncomputation: []", ["computation"]],
    ["executor aggregate", "type: note\nexecutor: nope", ["executor"]],
    ["executor children", "type: note\nexecutor: {}", ["executor.resource", "executor.receipt"]],
    ["executor receipt member", "type: note\nexecutor:\n  resource: x\n  receipt: [ok, 1]", ["executor.receipt[1]"]],
    ["attester aggregate", "type: note\nattester: nope", ["attester"]],
    ["attester child", "type: note\nattester: {}", ["attester.resource"]],
  ])("validates %s without dropping bad members", (_name, yaml, expected) => {
    expect(fields(yaml)).toEqual(expected);
  });

  it("accepts every official field, empty ordinary strings/lists, and reversed windows", () => {
    expect(validate(`
      type: Attested Computation
      title: ''
      description: ''
      resource: ../missing
      tags: ['', duplicate, duplicate]
      sources:
        - resource: ../source
          id: ''
          title: ''
          author: producer/version
          usage_count: -1.5
          last_modified: 2026-08-24T10:00:00Z
          usage_window:
            from: 2027-08-24T10:00:00Z
            to: 2026-08-24T10:00:00Z
          nested_extension: accepted
      usage_window:
        from: 2027-08-24T10:00:00+01:00
        to: 2026-08-24T10:00:00Z
      generated:
        by: process:builder
        at: 2026-08-24T10:00:00.1239Z
      verified:
        by: human:alice
        at: 2026-08-24T10:00:00Z
      status: stable
      stale_after: 2026-08-24T10:00:00Z
      runtime: ''
      parameters:
        - name: ''
          type: ''
          required: false
      computation: ../missing.ts
      executor:
        resource: ../executor
        receipt: []
      attester:
        resource: ../attester
      extension: accepted
    `, "[broken](../missing.md)")).toEqual({
      isValid: true,
      errors: [],
    });
  });

  it("accepts unknown types, top-level/nested keys, and inert resource paths", () => {
    expect(validate(`
      type: future-kind
      unknown: {anything: true}
      sources:
        - resource: C:/not-an-identity
          future_key: 1
      generated:
        by: org/tool
        future_key: 2
    `, "[missing](../../missing.md)")).toEqual({
      isValid: true,
      errors: [],
    });
  });

  it("orders independent diagnostics by fixed field, index, and child order", () => {
    const errors = validate(`
      attester: {}
      status: future
      sources:
        - {}
        - resource: ok
          author: bad actor
      type: ' '
      tags: [ok, 2]
      verified:
        - {}
        - nope
      executor: {}
    `).errors;
    expect(errors.map((item) => item.field)).toEqual([
      "type",
      "tags[1]",
      "sources[0].resource",
      "sources[1].author",
      "verified[0].by",
      "verified[0].at",
      "verified[1]",
      "status",
      "executor.resource",
      "executor.receipt",
      "attester.resource",
    ]);
  });

  it("returns fresh results and detached diagnostic objects and arrays", () => {
    const first = validate("type: note\nstatus: future");
    const second = validate("type: note\nstatus: future");
    const errors = first.errors as OkfDiagnostic[];

    expect(first).not.toBe(second);
    expect(first.errors).not.toBe(second.errors);

    errors[0]!.message = "changed";
    errors.push({ code: "ERR_OKF_FIELD", path: "x", message: "x" });

    expect(second).toEqual({
      isValid: false,
      errors: [
        expect.objectContaining({
          code: "ERR_OKF_FIELD",
          path: "concept.md",
          field: "status",
          message: "Invalid OKF field: concept.md (status)",
        }),
      ],
    });
  });

  it("normalizes bare verification to indexed diagnostic paths", () => {
    expect(fields("type: note\nverified: {}"))
      .toEqual(["verified[0].by", "verified[0].at"]);
  });

  it.each([
    ["sources:\n  - resource: x\n    author: 'human:'", "sources[0].author"],
    ["generated:\n  by: bad actor", "generated.by"],
    ["verified:\n  by: 'process:'\n  at: 2026-08-24T10:00:00Z", "verified[0].by"],
    ["sources:\n  - resource: x\n    last_modified: 2026-08-24", "sources[0].last_modified"],
    ["sources:\n  - resource: x\n    usage_window: {from: bad, to: 2026-08-24T10:00:00Z}", "sources[0].usage_window.from"],
    ["usage_window: {from: bad, to: 2026-08-24T10:00:00Z}", "usage_window.from"],
    ["generated:\n  by: process:x\n  at: bad", "generated.at"],
    ["verified:\n  by: process:x\n  at: bad", "verified[0].at"],
    ["stale_after: bad", "stale_after"],
  ])("applies actor/timestamp rules at %s", (yaml, field) => {
    expect(fields(`type: note\n${yaml}`)).toContain(field);
  });

  it("requires runtime only for the exact Attested Computation type", () => {
    expect(fields("type: Attested Computation")).toEqual(["runtime"]);
    expect(validate("type: Attested Computation\nruntime: node")).toEqual({
      isValid: true,
      errors: [],
    });
    expect(validate("type: attested computation")).toEqual({
      isValid: true,
      errors: [],
    });
  });

  it("keeps validator and ingest on the same first diagnostic", async () => {
    const input = {
      path: "parity.md",
      markdown: concept("type: note\ntags: [ok, 1]\nstatus: future"),
    };
    const [first] = validateOkfDocument(input).errors;
    const expected = {
      code: first!.code,
      path: first!.path,
      field: first!.field,
      message: first!.message,
    };
    const validation = validateOkfDocument(input);
    const errors = validation.errors as OkfDiagnostic[];
    errors[0]!.message = "changed";
    errors.length = 0;
    const tree = await createBundle({});
    try {
      const okf = await openOkf(tree.root);
      expect(() => okf.ingest(input)).toThrow(expect.objectContaining(expected));
    } finally {
      await tree.cleanup();
    }
  });

  it("exports the exact diagnostic code union", () => {
    const codes: OkfDiagnosticCode[] = ["ERR_OKF_PARSE", "ERR_OKF_FIELD"];
    expect(codes).toHaveLength(2);
  });
});
