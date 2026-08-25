import type MiniSearch from "minisearch";
import type {
  SearchResult,
} from "minisearch";

import {
  isOkfStatus,
  isOkfTrustTier,
} from "./vocabulary.js";

import type {
  OkfIndexRecord,
  OkfSearchField,
  OkfSearchHit,
  OkfSearchOptions,
} from "./types.js";

type SearchFilters = NonNullable<
  OkfSearchOptions["where"]
>;

type IndexedField =
  | "resource"
  | "title"
  | "headingPath"
  | "description"
  | "tags"
  | "type"
  | "sourceText"
  | "text";

const PUBLIC_FIELDS: readonly OkfSearchField[] = [
  "resource",
  "title",
  "heading",
  "description",
  "tags",
  "type",
  "sources",
  "body",
];

const PUBLIC_TO_INDEXED_FIELD: Record<
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

const INDEXED_TO_PUBLIC_FIELD: Record<
  IndexedField,
  OkfSearchField
> = {
  resource: "resource",
  title: "title",
  headingPath: "heading",
  description: "description",
  tags: "tags",
  type: "type",
  sourceText: "sources",
  text: "body",
};

const FILTER_NAMES = [
  "types",
  "tagsAny",
  "statuses",
  "trustTiers",
  "stale",
] as const;

type FilterName = typeof FILTER_NAMES[number];

type IndexedHit = SearchResult &
  Pick<
    OkfIndexRecord,
    | "documentId"
    | "title"
    | "path"
    | "type"
    | "tags"
    | "status"
    | "staleAfterEpoch"
    | "stalenessClassified"
    | "trustTier"
    | "headingPath"
    | "text"
    | "startLine"
    | "endLine"
  >;

export function search(
  index: MiniSearch<OkfIndexRecord>,
  query: string,
  options: OkfSearchOptions = {},
): OkfSearchHit[] {
  const asOf =
    options.asOf ?? new Date();

  if (
    !(asOf instanceof Date) ||
    Number.isNaN(asOf.getTime())
  ) {
    throw new TypeError(
      "options.asOf must be a valid Date",
    );
  }

  const limit =
    options.limit === undefined
      ? 10
      : options.limit;

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

  const combineWith = validateMatch(
    options.match,
  );
  const fields = normalizeFields(
    options.fields,
  );

  if (
    options.fuzzy !== undefined &&
    typeof options.fuzzy !== "boolean"
  ) {
    throw new TypeError(
      "options.fuzzy must be a boolean",
    );
  }

  const where = validateWhere(
    options.where,
  );

  const normalizedQuery = query.trim();

  if (!normalizedQuery || limit === 0) {
    return [];
  }

  const rawHits = index.search(
    normalizedQuery,
    {
      boost: {
        resource: 6,
        title: 5,
        headingPath: 4,
        description: 3,
        tags: 2,
        type: 1.5,
        sourceText: 1,
        text: 1,
      },

      prefix: (
        term,
        index,
        terms,
      ) =>
        index === terms.length - 1 &&
        term.length >= 3,

      combineWith,
      ...(fields ? { fields } : {}),
      ...(options.fuzzy === true
        ? { fuzzy: 0.2 }
        : {}),

      filter: (result) =>
        matchesFilters(
          result as IndexedHit,
          where,
          asOf,
        ),
    },
  ) as IndexedHit[];

  rawHits.sort((left, right) => {
    const byScore = right.score - left.score;

    if (byScore) {
      return byScore;
    }

    const leftId = String(left.id);
    const rightId = String(right.id);

    return leftId < rightId
      ? -1
      : leftId > rightId
        ? 1
        : 0;
  });

  const hits: OkfSearchHit[] = [];
  const seenDocuments =
    new Set<string>();

  for (const hit of rawHits) {
    if (
      seenDocuments.has(hit.documentId)
    ) {
      continue;
    }

    seenDocuments.add(hit.documentId);

    hits.push({
      documentId: hit.documentId,
      title: hit.title,
      sectionId: String(hit.id),
      score: hit.score,

      matchedFields: translateMatchedFields(
        hit.match,
      ),

      headingPath: hit.headingPath,
      path: hit.path,
      startLine: hit.startLine,
      endLine: hit.endLine,

      snippet: makeSnippet(
        hit.text,
        hit.terms,
      ),
    });

    if (hits.length === limit) {
      break;
    }
  }

  return hits;
}

function validateMatch(
  match: OkfSearchOptions["match"],
): "OR" | "AND" {
  if (
    match !== undefined &&
    match !== "any" &&
    match !== "all"
  ) {
    throw new TypeError(
      'options.match must be "any" or "all"',
    );
  }

  return match === "all" ? "AND" : "OR";
}

function normalizeFields(
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

function validateWhere(
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
    if (typeof where.stale !== "boolean") {
      throw new TypeError(
        "options.where.stale must be a boolean",
      );
    }

    validated.stale = where.stale;
  }

  return validated;
}

function validateFilterArray<T>(
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

  for (let index = 0; index < value.length; index++) {
    if (
      !Object.hasOwn(value, index) ||
      !isValidEntry(value[index])
    ) {
      throw new TypeError(
        invalidEntryMessage,
      );
    }
  }

  return value;
}

function translateMatchedFields(
  match: Record<string, readonly string[]>,
): OkfSearchField[] {
  const fields: OkfSearchField[] = [];

  for (const matchedFields of Object.values(match)) {
    for (const indexedField of matchedFields) {
      if (
        !Object.hasOwn(
          INDEXED_TO_PUBLIC_FIELD,
          indexedField,
        )
      ) {
        continue;
      }

      const publicField =
        INDEXED_TO_PUBLIC_FIELD[
          indexedField as IndexedField
        ];

      if (!fields.includes(publicField)) {
        fields.push(publicField);
      }
    }
  }

  return fields;
}

function matchesFilters(
  hit: IndexedHit,
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

  return true;
}

function isStale(
  staleAfterEpoch: number | undefined,
  asOf: Date,
): boolean {
  return staleAfterEpoch !== undefined &&
    staleAfterEpoch <= asOf.getTime();
}

function makeSnippet(
  text: string,
  matchedTerms: readonly string[],
  maxLength = 240,
): string {
  const lower = text.toLowerCase();

  const firstMatch = matchedTerms.reduce(
    (earliest, term) => {
      const position = lower.indexOf(
        term.toLowerCase(),
      );

      return position < 0
        ? earliest
        : Math.min(earliest, position);
    },
    Number.POSITIVE_INFINITY,
  );

  const start = Number.isFinite(
    firstMatch,
  )
    ? Math.max(0, firstMatch - 80)
    : 0;

  const end = Math.min(
    text.length,
    start + maxLength,
  );

  return [
    start > 0 ? "…" : "",
    text.slice(start, end).trim(),
    end < text.length ? "…" : "",
  ].join("");
}