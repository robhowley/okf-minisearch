import type MiniSearch from "minisearch";
import type {
  SearchResult,
} from "minisearch";

import type {
  OkfIndexRecord,
  OkfSearchHit,
  OkfSearchOptions,
} from "./types.js";

type IndexedHit = SearchResult &
  Pick<
    OkfIndexRecord,
    | "documentId"
    | "type"
    | "tags"
    | "status"
    | "staleAfter"
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
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return [];
  }

  const asOf =
    options.asOf ?? new Date();

  const limit =
    options.limit ?? 10;

  const rawHits = index.search(
    normalizedQuery,
    {
      boost: {
        documentId: 6,
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

      filter: (result) =>
        matchesFilters(
          result as IndexedHit,
          options,
          asOf,
        ),
    },
  ) as IndexedHit[];

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
      sectionId: String(hit.id),
      score: hit.score,

      matchedFields: [
        ...new Set(
          Object.values(hit.match).flat(),
        ),
      ],

      headingPath: hit.headingPath,
      path: `${hit.documentId}.md`,
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

function matchesFilters(
  hit: IndexedHit,
  options: OkfSearchOptions,
  asOf: Date,
): boolean {
  const where = options.where;

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
    !where.statuses.includes(hit.status)
  ) {
    return false;
  }

  if (
    where.trustTiers?.length &&
    !where.trustTiers.includes(
      hit.trustTier,
    )
  ) {
    return false;
  }

  if (
    where.stale !== undefined &&
    isStale(hit.staleAfter, asOf) !==
      where.stale
  ) {
    return false;
  }

  return true;
}

function isStale(
  staleAfter: string | undefined,
  asOf: Date,
): boolean {
  return (
    staleAfter !== undefined &&
    Date.parse(staleAfter) <=
      asOf.getTime()
  );
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