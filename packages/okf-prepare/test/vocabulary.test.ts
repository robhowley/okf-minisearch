import { describe, expect, it } from "vitest";

import {
  isOkfConformance,
  isOkfStatus,
  isOkfTrustTier,
} from "../src/index.js";

import type {
  OkfConformance,
  OkfStatus,
  OkfTrustTier,
} from "../src/index.js";

const statuses = [
  "draft",
  "stable",
  "deprecated",
] as const;

const trustTiers = [
  "unverified",
  "machine-confirmed",
  "human-reviewed",
] as const;

const conformances = [
  "strict",
  "degraded",
] as const;

const invalidValues: unknown[] = [
  undefined,
  null,
  0,
  false,
  {},
  [],
  "unknown",
  "Draft",
];

describe("OKF vocabulary predicates", () => {
  it.each(statuses)("accepts status %s and narrows it", (value) => {
    const candidate: unknown = value;

    expect(isOkfStatus(candidate)).toBe(true);
    if (!isOkfStatus(candidate)) {
      expect.unreachable();
    }

    const status: OkfStatus = candidate;
    expect(status).toBe(value);
  });

  it.each(trustTiers)("accepts trust tier %s and narrows it", (value) => {
    const candidate: unknown = value;

    expect(isOkfTrustTier(candidate)).toBe(true);
    if (!isOkfTrustTier(candidate)) {
      expect.unreachable();
    }

    const trustTier: OkfTrustTier = candidate;
    expect(trustTier).toBe(value);
  });

  it.each(conformances)("accepts conformance %s and narrows it", (value) => {
    const candidate: unknown = value;

    expect(isOkfConformance(candidate)).toBe(true);
    if (!isOkfConformance(candidate)) {
      expect.unreachable();
    }

    const conformance: OkfConformance = candidate;
    expect(conformance).toBe(value);
  });

  it("rejects non-string and unknown values for every vocabulary", () => {
    for (const value of invalidValues) {
      expect(isOkfStatus(value)).toBe(false);
      expect(isOkfTrustTier(value)).toBe(false);
      expect(isOkfConformance(value)).toBe(false);
    }
  });
});
