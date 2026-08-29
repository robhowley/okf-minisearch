import {
  isOkfStatus,
  isOkfTrustTier,
} from "./vocabulary.js";

import type {
  OkfConformance,
  OkfSearchField,
  OkfSearchOptions,
} from "./types.js";
import type { OkfIndexRecord } from "./internal-types.js";

export type SearchFilters = NonNullable<
  OkfSearchOptions["where"]
>;

export type SearchBoosts = Partial<
  Record<OkfSearchField, number>
>;

export type IndexedField =
  | "resource"
  | "title"
  | "headingPath"
  | "description"
  | "tags"
  | "type"
  | "sourceText"
  | "text";

export const PUBLIC_FIELDS: readonly OkfSearchField[] = [
  "resource",
  "title",
  "heading",
  "description",
  "tags",
  "type",
  "sources",
  "body",
];

export const PUBLIC_TO_INDEXED_FIELD: Record<
  OkfSearchField,
  IndexedField
> = {
  resource: "resource",
  title: "title",
  heading: "headingPath",
  description: "description",
  tags: "tags",
  type: "type",
  sources: "sourceText",
  body: "text",
};

const FILTER_NAMES = [
  "types",
  "tagsAny",
  "statuses",
  "trustTiers",
  "stale",
  "conformance",
] as const;

type FilterName = typeof FILTER_NAMES[number];

export type FilterableHit = Pick<
  OkfIndexRecord,
  | "conformance"
  | "type"
  | "tags"
  | "status"
  | "staleAfterEpoch"
  | "stalenessClassified"
  | "trustTier"
>;

export function validateAsOf(value: unknown): Date {
  if (
    !(value instanceof Date) ||
    Number.isNaN(value.getTime())
  ) {
    throw new TypeError(
      "options.asOf must be a valid Date",
    );
  }

  return value;
}

export function validateLimit(value: unknown): number {
  const limit = value === undefined ? 10 : value;

  if (
    typeof limit !== "number" ||
    !Number.isFinite(limit) ||
    !Number.isInteger(limit) ||
    limit < 0
  ) {
    throw new TypeError(
      "options.limit must be a finite non-negative integer",
    );
  }

  return limit;
}

export function normalizeMatch(
  match: unknown,
): "OR" | "AND" | undefined {
  if (
    match !== undefined &&
    match !== "any" &&
    match !== "all"
  ) {
    throw new TypeError(
      'options.match must be "any" or "all"',
    );
  }

  return match === "any"
    ? "OR"
    : match === "all"
      ? "AND"
      : undefined;
}

export function normalizeFields(
  fields: OkfSearchOptions["fields"],
): IndexedField[] | undefined {
  if (fields === undefined) {
    return undefined;
  }

  if (!Array.isArray(fields) || fields.length === 0) {
    throw new TypeError(
      "options.fields must be a non-empty array",
    );
  }

  const normalized: IndexedField[] = [];

  for (const field of fields as readonly unknown[]) {
    if (
      typeof field !== "string" ||
      !PUBLIC_FIELDS.includes(
        field as OkfSearchField,
      )
    ) {
      throw new TypeError(
        "options.fields must contain only valid OkfSearchField values",
      );
    }

    const indexedField =
      PUBLIC_TO_INDEXED_FIELD[
        field as OkfSearchField
      ];

    if (!normalized.includes(indexedField)) {
      normalized.push(indexedField);
    }
  }

  return normalized;
}

export function normalizeFuzzy(
  fuzzy: OkfSearchOptions["fuzzy"],
): number | undefined {
  if (fuzzy === undefined || fuzzy === false) {
    return undefined;
  }

  if (fuzzy === true) {
    return 0.2;
  }

  if (
    typeof fuzzy !== "number" ||
    !Number.isFinite(fuzzy) ||
    fuzzy < 0 ||
    fuzzy > 1
  ) {
    throw new TypeError(
      "options.fuzzy must be a boolean or a finite number between 0 and 1, inclusive",
    );
  }

  return fuzzy;
}

export function validateWhere(
  where: OkfSearchOptions["where"],
): SearchFilters | undefined {
  if (where === undefined) {
    return undefined;
  }

  if (
    where === null ||
    typeof where !== "object" ||
    Array.isArray(where)
  ) {
    throw new TypeError(
      "options.where must be an object",
    );
  }

  for (const key of Reflect.ownKeys(where)) {
    if (
      Object.prototype.propertyIsEnumerable.call(
        where,
        key,
      ) &&
      (
        typeof key !== "string" ||
        !FILTER_NAMES.includes(key as FilterName)
      )
    ) {
      throw new TypeError(
        "options.where must contain only valid filter names",
      );
    }
  }

  const validated: SearchFilters = {};

  if (Object.hasOwn(where, "types")) {
    validated.types = validateFilterArray(
      where.types,
      "types",
      (entry): entry is string =>
        typeof entry === "string",
      "options.where.types must contain only strings",
    );
  }

  if (Object.hasOwn(where, "tagsAny")) {
    validated.tagsAny = validateFilterArray(
      where.tagsAny,
      "tagsAny",
      (entry): entry is string =>
        typeof entry === "string",
      "options.where.tagsAny must contain only strings",
    );
  }

  if (Object.hasOwn(where, "statuses")) {
    validated.statuses = validateFilterArray(
      where.statuses,
      "statuses",
      isOkfStatus,
      "options.where.statuses must contain only valid OkfStatus values",
    );
  }

  if (Object.hasOwn(where, "trustTiers")) {
    validated.trustTiers = validateFilterArray(
      where.trustTiers,
      "trustTiers",
      isOkfTrustTier,
      "options.where.trustTiers must contain only valid OkfTrustTier values",
    );
  }

  if (Object.hasOwn(where, "stale")) {
    const stale = where.stale;

    if (typeof stale !== "boolean") {
      throw new TypeError(
        "options.where.stale must be a boolean",
      );
    }

    validated.stale = stale;
  }

  if (Object.hasOwn(where, "conformance")) {
    validated.conformance = validateFilterArray(
      where.conformance,
      "conformance",
      (entry): entry is OkfConformance =>
        entry === "strict" || entry === "degraded",
      "options.where.conformance must contain only valid OkfConformance values",
    );
  }

  return validated;
}

export function validateBoost(
  boost: OkfSearchOptions["boost"],
): SearchBoosts {
  if (boost === undefined) {
    return {};
  }

  if (
    boost === null ||
    typeof boost !== "object" ||
    Array.isArray(boost)
  ) {
    throw new TypeError(
      "options.boost must be an object",
    );
  }

  for (const key of Reflect.ownKeys(boost)) {
    if (
      Object.prototype.propertyIsEnumerable.call(
        boost,
        key,
      ) &&
      (
        typeof key !== "string" ||
        !PUBLIC_FIELDS.includes(
          key as OkfSearchField,
        )
      )
    ) {
      throw new TypeError(
        "options.boost must contain only valid OkfSearchField keys",
      );
    }
  }

  const boosts: SearchBoosts = {};

  for (const field of PUBLIC_FIELDS) {
    if (!Object.hasOwn(boost, field)) {
      continue;
    }

    const value = boost[field];

    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0.1 ||
      value > 10
    ) {
      throw new TypeError(
        `options.boost.${field} must be a finite number between 0.1 and 10, inclusive`,
      );
    }

    boosts[field] = value;
  }

  return boosts;
}

export function makeIndexedBoosts(
  boosts: SearchBoosts,
  defaults?: Readonly<Record<OkfSearchField, number>>,
): Partial<Record<IndexedField, number>> {
  const indexedBoosts: Partial<
    Record<IndexedField, number>
  > = {};

  for (const field of PUBLIC_FIELDS) {
    const boost = Object.hasOwn(boosts, field)
      ? boosts[field]
      : defaults?.[field];

    if (boost !== undefined) {
      indexedBoosts[PUBLIC_TO_INDEXED_FIELD[field]] = boost;
    }
  }

  return indexedBoosts;
}

export function matchesFilters(
  hit: FilterableHit,
  where: SearchFilters | undefined,
  asOf: Date,
): boolean {
  if (!where) {
    return true;
  }

  if (
    where.types?.length &&
    !where.types.includes(hit.type)
  ) {
    return false;
  }

  if (
    where.tagsAny?.length &&
    !where.tagsAny.some((tag) =>
      hit.tags.includes(tag),
    )
  ) {
    return false;
  }

  if (
    where.statuses?.length &&
    (
      !hit.status ||
      !where.statuses.includes(hit.status)
    )
  ) {
    return false;
  }

  if (
    where.trustTiers?.length &&
    (
      !hit.trustTier ||
      !where.trustTiers.includes(
        hit.trustTier,
      )
    )
  ) {
    return false;
  }

  if (where.stale !== undefined) {
    if (!hit.stalenessClassified) {
      return false;
    }

    if (
      isStale(
        hit.staleAfterEpoch,
        asOf,
      ) !== where.stale
    ) {
      return false;
    }
  }

  if (
    where.conformance?.length &&
    !where.conformance.includes(hit.conformance)
  ) {
    return false;
  }

  return true;
}

export function validateFilterArray<T>(
  value: unknown,
  field: string,
  isValidEntry: (entry: unknown) => entry is T,
  invalidEntryMessage: string,
): readonly T[] {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `options.where.${field} must be an array`,
    );
  }

  const validated: T[] = [];

  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(
        invalidEntryMessage,
      );
    }

    const entry = value[index];

    if (!isValidEntry(entry)) {
      throw new TypeError(
        invalidEntryMessage,
      );
    }

    validated.push(entry);
  }

  return validated;
}

function isStale(
  staleAfterEpoch: number | undefined,
  asOf: Date,
): boolean {
  return staleAfterEpoch !== undefined &&
    staleAfterEpoch <= asOf.getTime();
}
