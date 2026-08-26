import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  openOkf,
  type OkfSearch,
  type OkfSearchField,
  type OkfSearchOptions,
} from "okf-minisearch";
import { resolve } from "node:path";

import { loadConfig } from "./config.js";

type RuntimeContext = Pick<
  ExtensionContext,
  "cwd" | "isProjectTrusted"
>;

interface Snapshot {
  readonly root: string;
  readonly search: OkfSearch;
}

interface RuntimeDependencies {
  readonly loadConfig?: typeof loadConfig;
  readonly openOkf?: typeof openOkf;
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
  search(
    ctx: RuntimeContext,
    request: RuntimeSearchRequest,
    signal?: AbortSignal,
  ): Promise<RuntimeSearchHit[]>;
} {
  const load = dependencies.loadConfig ?? loadConfig;
  const open = dependencies.openOkf ?? openOkf;
  let snapshot: Snapshot | undefined;
  let buildPromise: Promise<Snapshot> | undefined;

  async function ensureSnapshot(
    ctx: RuntimeContext,
    signal?: AbortSignal,
  ): Promise<Snapshot> {
    signal?.throwIfAborted();

    if (snapshot) {
      signal?.throwIfAborted();
      return snapshot;
    }

    let pending = buildPromise;

    if (!pending) {
      const opening = Promise.resolve().then(async () => {
        const { root } = load(ctx);
        const search = await open(root);
        return { root, search } satisfies Snapshot;
      });

      pending = opening.then(
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
    }

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

    async search(ctx, request, signal): Promise<RuntimeSearchHit[]> {
      const current = await ensureSnapshot(ctx, signal);
      signal?.throwIfAborted();

      const options: OkfSearchOptions = {
        limit: request.limit === undefined ? 5 : request.limit,
        ...(request.match !== undefined ? { match: request.match } : {}),
        ...(request.fields !== undefined ? { fields: request.fields } : {}),
        ...(request.fuzzy !== undefined ? { fuzzy: request.fuzzy } : {}),
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
