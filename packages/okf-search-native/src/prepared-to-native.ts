import type {
  PreparedOkfDocument,
} from "@okf-internal/prepare";

import type {
  PreparedDocument as NativePreparedDocument,
} from "../native.cjs";

type NativeDocumentFacets = Pick<
  NativePreparedDocument,
  "status" | "staleAfterEpoch" | "stalenessClassified" | "trustTier"
>;

/**
 * Map one accepted preparation result to the hierarchical DTO consumed by
 * napi.
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
  return {
    documentId: identity.documentId,
    path: identity.path,
    type,
    conformance,
    diagnostics: diagnostics.map((diagnostic) => ({ ...diagnostic })),
    title: metadata.title,
    tags: [...metadata.tags],
    ...mapFacets(facets),
    resource: metadata.resource ?? "",
    description: metadata.description ?? "",
    sourceText: metadata.sourceText,
    sections: sections.map((section) => ({
      sectionId: section.id,
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
): NativeDocumentFacets {
  const result: NativeDocumentFacets = {
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
