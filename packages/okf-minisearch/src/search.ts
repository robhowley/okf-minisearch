import type MiniSearch from "minisearch";
import type {
  SearchResult,
} from "minisearch";

import {
  makeIndexedBoosts,
  matchesFilters,
  normalizeFields,
  normalizeFuzzy,
  normalizeMatch,
  validateAsOf,
  validateBoost,
  validateLimit,
  validateWhere,
} from "./search-options.js";

import type {
  IndexedField,
} from "./search-options.js";
import type {
  OkfSearchField,
  OkfSearchHit,
  OkfSearchOptions,
} from "./types.js";
import type { OkfIndexRecord } from "./internal-types.js";

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

const BASELINE_FIELD_BOOSTS: Record<
  OkfSearchField,
  number
> = {
  resource: 6,
  title: 5,
  heading: 4,
  description: 3,
  tags: 2,
  type: 1.5,
  sources: 1,
  body: 1,
};

type IndexedHit = SearchResult &
  Pick<
    OkfIndexRecord,
    | "documentId"
    | "conformance"
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
  const asOf = validateAsOf(
    options.asOf ?? new Date(),
  );
  const limit = validateLimit(options.limit);
  const combineWith =
    normalizeMatch(options.match) ?? "OR";
  const fields = normalizeFields(
    options.fields,
  );
  const fuzzy = normalizeFuzzy(
    options.fuzzy,
  );
  const where = validateWhere(
    options.where,
  );
  const boosts = validateBoost(
    options.boost,
  );

  const normalizedQuery = query.trim();

  if (!normalizedQuery || limit === 0) {
    return [];
  }

  const rawHits = index.search(
    normalizedQuery,
    {
      boost: makeIndexedBoosts(
        boosts,
        BASELINE_FIELD_BOOSTS,
      ),

      prefix: (
        term,
        index,
        terms,
      ) =>
        index === terms.length - 1 &&
        term.length >= 3,

      combineWith,
      ...(fields ? { fields } : {}),
      ...(fuzzy === undefined
        ? {}
        : { fuzzy }),

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

    if (left.conformance !== right.conformance) {
      return left.conformance === "strict" ? -1 : 1;
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
      conformance: hit.conformance,

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
