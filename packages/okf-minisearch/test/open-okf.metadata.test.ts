import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import { openOkf } from "../src/index.js";
import type {
  OkfSearch,
  OkfSearchOptions,
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

async function open(
  files: Record<string, string>,
): Promise<OkfSearch> {
  const tree = await createBundle(files);
  bundles.push(tree);
  return openOkf(tree.root);
}

function ids(
  okf: OkfSearch,
  options: OkfSearchOptions = {},
): string[] {
  return okf.search("facetneedle", {
    limit: 100,
    ...options,
  }).map((hit) => hit.documentId).sort();
}

describe("optional metadata", () => {
  it("accepts unknown fields and types", async () => {
    const okf = await open({
      "unknown.md": concept(`
        type: unknown-kind
        okf: {version: strange}
        extra: accepted
      `, "facetneedle unknown"),
    });

    expect(ids(okf)).toEqual(["unknown"]);
  });

  it.each([
    ["status", "status: future", "status"],
    ["verification", "verified: broken", "verified"],
    ["staleness", "stale_after: yesterday", "stale_after"],
  ])("rejects malformed present %s metadata", async (_name, metadata, field) => {
    const tree = await createBundle({
      "malformed.md": concept(`type: note\n${metadata}`, "facetneedle"),
    });
    bundles.push(tree);

    await expect(openOkf(tree.root)).rejects.toMatchObject({
      code: "ERR_OKF_FIELD",
      path: "malformed.md",
      field,
    });
  });

  it("classifies valid status values and defaults absent status to stable", async () => {
    const okf = await open({
      "absent.md": concept("type: note", "facetneedle absent"),
      "draft.md": concept("type: note\nstatus: draft", "facetneedle draft"),
      "stable.md": concept("type: note\nstatus: stable", "facetneedle stable"),
      "deprecated.md": concept("type: note\nstatus: deprecated", "facetneedle deprecated"),
    });

    expect(ids(okf)).toHaveLength(4);
    expect(ids(okf, {
      where: { statuses: ["stable"] },
    })).toEqual(["absent", "stable"]);
    expect(ids(okf, {
      where: { statuses: ["draft"] },
    })).toEqual(["draft"]);
    expect(ids(okf, {
      where: { statuses: ["deprecated"] },
    })).toEqual(["deprecated"]);
  });

  it("classifies valid bare/list verification", async () => {
    const okf = await open({
      "absent.md": concept("type: note", "facetneedle absent"),
      "empty.md": concept("type: note\nverified: []", "facetneedle empty"),
      "process.md": concept(`
        type: note
        verified:
          by: process:builder
          at: 2026-08-24T10:00:00Z
      `, "facetneedle process"),
      "repository.md": concept(`
        type: note
        verified:
          - by: org/reviewer
            at: 2026-08-24T10:00:00.1234+01:00
      `, "facetneedle repository"),
      "human.md": concept(`
        type: note
        verified:
          - by: process:builder
            at: 2026-08-24T10:00:00Z
          - by: human:alice
            at: 2026-08-24T11:00:00+01:00
      `, "facetneedle human"),
    });

    expect(ids(okf)).toHaveLength(5);
    expect(ids(okf, {
      where: { trustTiers: ["unverified"] },
    })).toEqual(["absent", "empty"]);
    expect(ids(okf, {
      where: { trustTiers: ["machine-confirmed"] },
    })).toEqual(["process", "repository"]);
    expect(ids(okf, {
      where: { trustTiers: ["human-reviewed"] },
    })).toEqual(["human"]);
  });

  it("compares valid offset timestamps at millisecond precision", async () => {
    const okf = await open({
      "absent.md": concept("type: note", "facetneedle absent"),
      "exact.md": concept(
        "type: note\nstale_after: 2026-08-24T10:00:00.123Z",
        "facetneedle exact",
      ),
      "z.md": concept(
        "type: note\nstale_after: 2026-08-24T10:00:00.1239Z",
        "facetneedle z",
      ),
      "offset.md": concept(
        "type: note\nstale_after: 2026-08-24T11:00:00.1239+01:00",
        "facetneedle offset",
      ),
    });
    const equality = new Date("2026-08-24T10:00:00.123Z");
    const nextMillisecond = new Date("2026-08-24T10:00:00.124Z");
    const before = new Date("2026-08-24T10:00:00.122Z");

    expect(ids(okf, {
      asOf: equality,
      where: { stale: true },
    })).toEqual(["exact"]);
    expect(ids(okf, {
      asOf: equality,
      where: { stale: false },
    })).toEqual(["absent", "offset", "z"]);
    expect(ids(okf, {
      asOf: nextMillisecond,
      where: { stale: true },
    })).toEqual(["exact", "offset", "z"]);
    expect(ids(okf, {
      asOf: nextMillisecond,
      where: { stale: false },
    })).toEqual(["absent"]);
    expect(ids(okf, {
      asOf: before,
      where: { stale: false },
    })).toEqual(["absent", "exact", "offset", "z"]);
  });

  it("validates asOf before returning a blank-query result", async () => {
    const okf = await open({
      "valid.md": concept("type: note", "facetneedle"),
    });
    const invalid = new Date(Number.NaN);

    expect(() => okf.search("", {
      asOf: invalid,
    })).toThrow(TypeError);
    expect(() => okf.search("facetneedle", {
      asOf: invalid,
    })).toThrow(TypeError);
  });
});
