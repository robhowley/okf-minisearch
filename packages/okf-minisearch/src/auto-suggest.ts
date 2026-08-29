import type MiniSearch from "minisearch";
import type { SearchResult } from "minisearch";

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
  FilterableHit,
} from "./search-options.js";
import type {
  OkfAutoSuggestOptions,
  OkfSuggestion,
} from "./types.js";
import type { OkfIndexRecord } from "./internal-types.js";

type IndexedSuggestionHit = SearchResult & FilterableHit;

export function autoSuggest(
  index: MiniSearch<OkfIndexRecord>,
  query: string,
  options: OkfAutoSuggestOptions = {},
): OkfSuggestion[] {
  const optionAsOf = options.asOf;
  const asOf = validateAsOf(
    optionAsOf === undefined
      ? new Date()
      : optionAsOf,
  );
  const limit = validateLimit(options.limit);
  const combineWith = normalizeMatch(
    options.match,
  );
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

  const indexedBoosts = makeIndexedBoosts(boosts);
  const suggestions = index.autoSuggest(
    normalizedQuery,
    {
      ...(fields ? { fields } : {}),
      ...(Object.keys(indexedBoosts).length
        ? { boost: indexedBoosts }
        : {}),
      ...(fuzzy === undefined
        ? {}
        : { fuzzy }),
      ...(combineWith === undefined
        ? {}
        : { combineWith }),
      filter: (result) =>
        matchesFilters(
          result as IndexedSuggestionHit,
          where,
          asOf,
        ),
    },
  );

  return suggestions
    .slice(0, limit)
    .map((suggestion) => ({
      suggestion: suggestion.suggestion,
      terms: [...suggestion.terms],
      score: suggestion.score,
    }));
}
