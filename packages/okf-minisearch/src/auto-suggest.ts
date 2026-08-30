import type MiniSearch from "minisearch";
import type { SearchResult } from "minisearch";

import {
  makeIndexedBoosts,
  matchesFilters,
  prepareSearchOptions,
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
  const resolvedAsOf = optionAsOf === undefined
    ? new Date()
    : optionAsOf;
  const {
    asOf,
    limit,
    combineWith,
    fields,
    fuzzy,
    where,
    boosts,
  } = prepareSearchOptions(options, resolvedAsOf);

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
