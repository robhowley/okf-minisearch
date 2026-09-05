import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  openOkf,
  type OkfSearch,
  type OkfSearchField,
  type OkfSearchOptions,
} from "okf-search-native";
import { resolve } from "node:path";

import { loadConfig } from "./config.js";

type RuntimeContext = Pick<
  ExtensionContext,
  "cwd" | "isProjectTrusted"
>;

export type RuntimeSearchHandle = Pick<
  OkfSearch,
  "search" | "listTypes" | "listDegradedDocuments"
>;

interface Snapshot {
  readonly root: string;
  readonly search: RuntimeSearchHandle;
  readonly indexedAt: number;
}

interface RuntimeDependencies {
  readonly loadConfig?: typeof loadConfig;
  readonly openOkf?: (root: string) => Promise<RuntimeSearchHandle>;
  readonly now?: () => number;
}

export type RuntimeSearchOptions = Pick<
  OkfSearchOptions,
  "limit" | "match" | "fields" | "fuzzy" | "where"
>;

export type RuntimeSearchRequest = RuntimeSearchOptions & {
  readonly query: string;
};

export interface RuntimeSearchHit {
  readonly title: string;
  readonly headingPath: string;
  readonly absolutePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly matchedFields: readonly OkfSearchField[];
  readonly snippet: string;
}

export function createRuntime(
  dependencies: RuntimeDependencies = {},
): {
  start(ctx: RuntimeContext): Promise<void>;
  refresh(ctx: RuntimeContext): Promise<void>;
  status(ctx: RuntimeContext): Promise<{
    readonly root: string;
    readonly types: readonly string[];
    readonly degradedDocumentCount: number;
    readonly indexedAt: number;
  }>;
  search(
    ctx: RuntimeContext,
    request: RuntimeSearchRequest,
    signal?: AbortSignal,
  ): Promise<RuntimeSearchHit[]>;
} {
  const load = dependencies.loadConfig ?? loadConfig;
  const open = dependencies.openOkf ?? openOkf;
  const now = dependencies.now ?? (() => Date.now());
  let snapshot: Snapshot | undefined;
  let buildPromise: Promise<Snapshot> | undefined;

  function startBuild(ctx: RuntimeContext): Promise<Snapshot> {
    const opening = Promise.resolve().then(async () => {
      const { root } = load(ctx);
      const search = await open(root);
      return { root, search, indexedAt: now() } satisfies Snapshot;
    });

    const pending = opening.then(
      (next) => {
        snapshot = next;
        buildPromise = undefined;
        return next;
      },
      (error) => {
        buildPromise = undefined;
        throw error;
      },
    );

    buildPromise = pending;
    return pending;
  }

  function ensureBuild(ctx: RuntimeContext): Promise<Snapshot> {
    return buildPromise ?? startBuild(ctx);
  }

  async function ensureSnapshot(
    ctx: RuntimeContext,
    signal?: AbortSignal,
  ): Promise<Snapshot> {
    signal?.throwIfAborted();

    if (snapshot) {
      signal?.throwIfAborted();
      return snapshot;
    }

    const pending = ensureBuild(ctx);

    let next: Snapshot;

    try {
      next = await pending;
    } catch (error) {
      signal?.throwIfAborted();
      throw error;
    }

    signal?.throwIfAborted();
    return next;
  }

  return {
    async start(ctx): Promise<void> {
      await ensureSnapshot(ctx);
    },

    async refresh(ctx): Promise<void> {
      await ensureBuild(ctx);
    },

    async status(ctx) {
      const current = await ensureSnapshot(ctx);
      return {
        root: current.root,
        types: current.search.listTypes(),
        degradedDocumentCount: current.search.listDegradedDocuments().length,
        indexedAt: current.indexedAt,
      };
    },

    async search(ctx, request, signal): Promise<RuntimeSearchHit[]> {
      const current = await ensureSnapshot(ctx, signal);
      signal?.throwIfAborted();

      const options: OkfSearchOptions = {
        limit: request.limit === undefined ? 5 : request.limit,
        match: request.match === undefined ? "any" : request.match,
        ...(request.fields !== undefined ? { fields: request.fields } : {}),
        fuzzy: request.fuzzy === undefined ? true : request.fuzzy,
        ...(request.where !== undefined ? { where: request.where } : {}),
      };

      return current.search.search(request.query.trim(), options).map((hit) => ({
        title: hit.title,
        headingPath: hit.headingPath,
        absolutePath: resolve(current.root, hit.path),
        startLine: hit.startLine,
        endLine: hit.endLine,
        matchedFields: hit.matchedFields,
        snippet: hit.snippet,
      }));
    },
  };
}
