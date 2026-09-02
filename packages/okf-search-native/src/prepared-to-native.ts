import type {
  PreparedOkfDocument,
} from "@okf-internal/prepare";

import type {
  PreparedDocument as NativePreparedDocument,
  PreparedSection as NativePreparedSection,
} from "../native.cjs";

type NativeSectionFacets = Pick<
  NativePreparedSection,
  "status" | "staleAfterEpoch" | "stalenessClassified" | "trustTier"
>;

type NativeSectionEnvelope = Omit<
  NativePreparedSection,
  | "sectionId"
  | "headingPath"
  | "text"
  | "startLine"
  | "endLine"
  | keyof NativeSectionFacets
> & NativeSectionFacets;

/**
 * Map one accepted preparation result to the flat DTO consumed by napi.
 *
 * Fatal preparation is represented by a thrown PrepareError, not by a value;
 * consequently this boundary accepts only strict or degraded results. The
 * runtime check keeps a value cast around that type from reaching native code.
 */
export function mapPreparedDocument(
  prepared: PreparedOkfDocument,
): NativePreparedDocument {
  assertAccepted(prepared);

  const { identity, metadata, facets, sections, diagnostics, type, conformance } = prepared;
  const documentId = identity.documentId;
  const path = identity.path;
  const sectionEnvelope: NativeSectionEnvelope = {
    documentId,
    conformance,
    title: metadata.title,
    path,
    type,
    tags: [...metadata.tags],
    ...mapFacets(facets),
    resource: metadata.resource ?? "",
    description: metadata.description ?? "",
    sourceText: metadata.sourceText,
  };

  return {
    documentId,
    path,
    type,
    conformance,
    diagnostics: diagnostics.map((diagnostic) => ({ ...diagnostic })),
    sections: sections.map((section) => ({
      sectionId: section.id,
      ...sectionEnvelope,
      tags: [...sectionEnvelope.tags],
      headingPath: section.headingPath,
      text: section.text,
      startLine: section.startLine,
      endLine: section.endLine,
    })),
  };
}

/** Map a prepared batch before one native constructor crossing. */
export function mapPreparedDocuments(
  prepared: readonly PreparedOkfDocument[],
): NativePreparedDocument[] {
  return prepared.map(mapPreparedDocument);
}

function mapFacets(
  facets: PreparedOkfDocument["facets"],
): NativeSectionFacets {
  const result: NativeSectionFacets = {
    stalenessClassified: facets.staleness.classified,
  };

  if (facets.status.classified) {
    result.status = facets.status.value;
  }
  if (facets.trust.classified) {
    result.trustTier = facets.trust.value;
  }

  const staleAfterEpoch = facets.staleness.staleAfterEpoch;
  if (facets.staleness.classified && staleAfterEpoch !== undefined) {
    result.staleAfterEpoch = staleAfterEpoch;
  }

  return result;
}

function assertAccepted(
  prepared: PreparedOkfDocument,
): asserts prepared is PreparedOkfDocument {
  if (
    prepared === null ||
    typeof prepared !== "object" ||
    (prepared.conformance !== "strict" && prepared.conformance !== "degraded")
  ) {
    throw new TypeError(
      "Fatal OKF preparation results cannot be mapped to native DTOs",
    );
  }
}
