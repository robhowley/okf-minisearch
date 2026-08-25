const OKF_STATUSES = [
  "draft",
  "stable",
  "deprecated",
] as const;

const TRUST_TIERS = [
  "unverified",
  "machine-confirmed",
  "human-reviewed",
] as const;

export type OkfStatus =
  typeof OKF_STATUSES[number];

export type OkfTrustTier =
  typeof TRUST_TIERS[number];

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
  return TRUST_TIERS.some(
    (tier) => tier === value,
  );
}
