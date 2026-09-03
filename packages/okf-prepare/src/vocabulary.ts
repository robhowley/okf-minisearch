import type {
  OkfConformance,
  OkfStatus,
  OkfTrustTier,
} from "./types.js";

const OKF_STATUSES = [
  "draft",
  "stable",
  "deprecated",
] as const;

const OKF_TRUST_TIERS = [
  "unverified",
  "machine-confirmed",
  "human-reviewed",
] as const;

const OKF_CONFORMANCE = [
  "strict",
  "degraded",
] as const;

export function isOkfStatus(
  value: unknown,
): value is OkfStatus {
  return OKF_STATUSES.some(
    (status) => status === value,
  );
}

export function isOkfTrustTier(
  value: unknown,
): value is OkfTrustTier {
  return OKF_TRUST_TIERS.some(
    (tier) => tier === value,
  );
}

export function isOkfConformance(
  value: unknown,
): value is OkfConformance {
  return OKF_CONFORMANCE.some(
    (conformance) => conformance === value,
  );
}
