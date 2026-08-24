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
  it("tolerates malformed recommended and unsupported fields", async () => {
    const okf = await open({
      "malformed.md": concept(`
        type: unknown-kind
        title: {not: a string}
        description: [not, a, string]
        resource: {not: a string}
        tags: [good, null, 3, also]
        sources: definitely-not-a-list
        usage_window: bad
        generated: 4
        computation: [bad]
        executor: nope
        attester: false
        okf: {version: strange}
        extra: accepted
      `, "facetneedle malformed optional"),
    });

    expect(ids(okf)).toEqual(["malformed"]);
    expect(ids(okf, {
      where: { tagsAny: ["good"] },
    })).toEqual(["malformed"]);
  });

  it("classifies valid status values and leaves malformed status unclassified", async () => {
    const okf = await open({
      "absent.md": concept("type: note", "facetneedle absent"),
      "draft.md": concept("type: note\nstatus: draft", "facetneedle draft"),
      "stable.md": concept("type: note\nstatus: stable", "facetneedle stable"),
      "deprecated.md": concept("type: note\nstatus: deprecated", "facetneedle deprecated"),
      "malformed.md": concept("type: note\nstatus: future", "facetneedle malformed"),
    });

    expect(ids(okf)).toHaveLength(5);
    expect(ids(okf, {
      where: { statuses: ["stable"] },
    })).toEqual(["absent", "stable"]);
    expect(ids(okf, {
      where: { statuses: ["draft"] },
    })).toEqual(["draft"]);
    expect(ids(okf, {
      where: { statuses: ["deprecated"] },
    })).toEqual(["deprecated"]);
    expect(ids(okf, {
      where: {
        statuses: ["draft", "stable", "deprecated"],
      },
    })).not.toContain("malformed");
  });

  it("classifies usable bare/list verification and leaves any unusable event unclassified", async () => {
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
      "bad-event.md": concept(`
        type: note
        verified:
          - by: process:builder
            at: 2026-08-24T10:00:00Z
          - by: 'human:'
            at: impossible
      `, "facetneedle bad"),
      "bad-field.md": concept("type: note\nverified: nope", "facetneedle bad field"),
    });

    expect(ids(okf)).toHaveLength(7);
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
      "z.md": concept(
        "type: note\nstale_after: 2026-08-24T10:00:00.123456Z",
        "facetneedle z",
      ),
      "offset.md": concept(
        "type: note\nstale_after: 2026-08-24T11:00:00.1239+01:00",
        "facetneedle offset",
      ),
      "impossible.md": concept(
        "type: note\nstale_after: 2026-02-30T10:00:00Z",
        "facetneedle impossible",
      ),
      "date-only.md": concept(
        "type: note\nstale_after: 2026-08-24",
        "facetneedle date only",
      ),
    });
    const equality = new Date("2026-08-24T10:00:00.123Z");
    const before = new Date("2026-08-24T10:00:00.122Z");

    expect(ids(okf, {
      asOf: equality,
      where: { stale: true },
    })).toEqual(["offset", "z"]);
    expect(ids(okf, {
      asOf: equality,
      where: { stale: false },
    })).toEqual(["absent"]);
    expect(ids(okf, {
      asOf: before,
      where: { stale: false },
    })).toEqual(["absent", "offset", "z"]);
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
