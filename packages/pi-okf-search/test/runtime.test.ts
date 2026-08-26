import { resolve } from "node:path";

import { OkfError } from "okf-minisearch";
import type {
  OkfSearch,
  OkfSearchHit,
  OkfSearchOptions,
} from "okf-minisearch";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createRuntime,
  type RuntimeSearchRequest,
} from "../extensions/okf-search/runtime.js";

const ctx = {
  cwd: "/workspace/project",
  isProjectTrusted: () => true,
};
const root = "/workspace/knowledge";

const unusedHandle: OkfSearch = {
  ingest: () => {
    throw new Error("ingest should not be called");
  },
  remove: () => false,
  search: () => [],
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

describe("createRuntime", () => {
  it("builds on start and returns undefined", async () => {
    const opening = deferred<OkfSearch>();
    const loadConfig = vi.fn(() => ({ root }));
    const openOkf = vi.fn(() => opening.promise);
    const runtime = createRuntime({ loadConfig, openOkf });

    const started = runtime.start(ctx);
    await Promise.resolve();

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(loadConfig).toHaveBeenCalledWith(ctx);
    expect(openOkf).toHaveBeenCalledTimes(1);
    expect(openOkf).toHaveBeenCalledWith(root);

    opening.resolve(unusedHandle);
    await expect(started).resolves.toBeUndefined();
  });

  it("reuses a successful build for later start and search calls", async () => {
    const searches: Array<{
      query: string;
      options?: OkfSearchOptions;
    }> = [];
    const handle: OkfSearch = {
      ...unusedHandle,
      search(query, options) {
        searches.push({ query, options });
        return [];
      },
    };
    const loadConfig = vi.fn(() => ({ root }));
    const openOkf = vi.fn(async () => handle);
    const runtime = createRuntime({ loadConfig, openOkf });

    await runtime.start(ctx);
    await runtime.start(ctx);
    await expect(runtime.search(ctx, { query: "needle" })).resolves.toEqual([]);

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(openOkf).toHaveBeenCalledTimes(1);
    expect(searches).toHaveLength(1);
  });

  it("coalesces concurrent start and search calls", async () => {
    const opening = deferred<OkfSearch>();
    const searches: string[] = [];
    const handle: OkfSearch = {
      ...unusedHandle,
      search(query) {
        searches.push(query);
        return [];
      },
    };
    const loadConfig = vi.fn(() => ({ root }));
    const openOkf = vi.fn(() => opening.promise);
    const runtime = createRuntime({ loadConfig, openOkf });

    const started = runtime.start(ctx);
    const first = runtime.search(ctx, { query: "first" });
    const second = runtime.search(ctx, { query: "second" });
    let startSettled = false;
    let firstSettled = false;
    let secondSettled = false;
    void started.then(() => {
      startSettled = true;
    });
    void first.then(
      () => {
        firstSettled = true;
      },
      () => {
        firstSettled = true;
      },
    );
    void second.then(
      () => {
        secondSettled = true;
      },
      () => {
        secondSettled = true;
      },
    );

    await Promise.resolve();
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(openOkf).toHaveBeenCalledTimes(1);
    expect(searches).toEqual([]);
    expect(startSettled).toBe(false);
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    opening.resolve(handle);
    await expect(Promise.all([started, first, second])).resolves.toEqual([
      undefined,
      [],
      [],
    ]);
    expect(searches).toEqual(["first", "second"]);
  });

  it("shares a failed build with concurrent callers", async () => {
    const opening = deferred<OkfSearch>();
    const failure = new Error("opening failed");
    const loadConfig = vi.fn(() => ({ root }));
    const openOkf = vi.fn(() => opening.promise);
    const runtime = createRuntime({ loadConfig, openOkf });

    const first = runtime.start(ctx);
    const second = runtime.start(ctx);
    await Promise.resolve();
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(openOkf).toHaveBeenCalledTimes(1);

    opening.reject(failure);
    await Promise.all([
      expect(first).rejects.toBe(failure),
      expect(second).rejects.toBe(failure),
    ]);
  });

  it("retries after a failed build instead of retaining the failure", async () => {
    const firstOpening = deferred<OkfSearch>();
    const firstFailure = new Error("first opening failed");
    let attempts = 0;
    const loadConfig = vi.fn(() => ({ root }));
    const openOkf = vi.fn(() => {
      attempts += 1;
      return attempts === 1
        ? firstOpening.promise
        : Promise.resolve(unusedHandle);
    });
    const runtime = createRuntime({ loadConfig, openOkf });

    const first = runtime.start(ctx);
    await Promise.resolve();
    firstOpening.reject(firstFailure);
    await expect(first).rejects.toBe(firstFailure);

    await expect(runtime.start(ctx)).resolves.toBeUndefined();
    expect(loadConfig).toHaveBeenCalledTimes(2);
    expect(openOkf).toHaveBeenCalledTimes(2);
  });

  it("coalesces synchronous configuration failures and retries later", async () => {
    const configFailure = new Error("configuration failed");
    let attempts = 0;
    const loadConfig = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) {
        throw configFailure;
      }
      return { root };
    });
    const openOkf = vi.fn(async () => unusedHandle);
    const runtime = createRuntime({ loadConfig, openOkf });

    const first = runtime.start(ctx);
    const second = runtime.start(ctx);
    await Promise.all([
      expect(first).rejects.toBe(configFailure),
      expect(second).rejects.toBe(configFailure),
    ]);
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(openOkf).not.toHaveBeenCalled();

    await expect(runtime.start(ctx)).resolves.toBeUndefined();
    expect(loadConfig).toHaveBeenCalledTimes(2);
    expect(openOkf).toHaveBeenCalledTimes(1);
  });

  it("rejects a pre-aborted search without starting any work", async () => {
    const reason = new Error("already canceled");
    const controller = new AbortController();
    controller.abort(reason);
    const searches: string[] = [];
    const handle: OkfSearch = {
      ...unusedHandle,
      search(query) {
        searches.push(query);
        return [];
      },
    };
    const loadConfig = vi.fn(() => ({ root }));
    const openOkf = vi.fn(async () => handle);
    const runtime = createRuntime({ loadConfig, openOkf });

    await expect(
      runtime.search(ctx, { query: "needle" }, controller.signal),
    ).rejects.toBe(reason);
    expect(loadConfig).not.toHaveBeenCalled();
    expect(openOkf).not.toHaveBeenCalled();
    expect(searches).toEqual([]);
  });

  it("keeps cancellation local while a shared build succeeds", async () => {
    const opening = deferred<OkfSearch>();
    const reason = new Error("caller canceled");
    const controller = new AbortController();
    const searches: string[] = [];
    const handle: OkfSearch = {
      ...unusedHandle,
      search(query) {
        searches.push(query);
        return [];
      },
    };
    const loadConfig = vi.fn(() => ({ root }));
    const openOkf = vi.fn(() => opening.promise);
    const runtime = createRuntime({ loadConfig, openOkf });

    const canceled = runtime.search(
      ctx,
      { query: "canceled" },
      controller.signal,
    );
    const active = runtime.search(ctx, { query: "active" });
    let canceledSettled = false;
    void canceled.then(
      () => {
        canceledSettled = true;
      },
      () => {
        canceledSettled = true;
      },
    );
    await Promise.resolve();

    controller.abort(reason);
    await Promise.resolve();
    expect(canceledSettled).toBe(false);
    expect(openOkf).toHaveBeenCalledTimes(1);

    opening.resolve(handle);
    await expect(canceled).rejects.toBe(reason);
    await expect(active).resolves.toEqual([]);
    expect(searches).toEqual(["active"]);

    await expect(runtime.search(ctx, { query: "cached" })).resolves.toEqual([]);
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(openOkf).toHaveBeenCalledTimes(1);
    expect(searches).toEqual(["active", "cached"]);
  });

  it("gives an aborted waiter its reason when a shared build fails", async () => {
    const opening = deferred<OkfSearch>();
    const buildFailure = new Error("opening failed");
    const abortReason = new Error("caller canceled");
    const controller = new AbortController();
    let attempts = 0;
    const loadConfig = vi.fn(() => ({ root }));
    const openOkf = vi.fn(() => {
      attempts += 1;
      return attempts === 1
        ? opening.promise
        : Promise.resolve(unusedHandle);
    });
    const runtime = createRuntime({ loadConfig, openOkf });

    const canceled = runtime.search(
      ctx,
      { query: "canceled" },
      controller.signal,
    );
    const active = runtime.search(ctx, { query: "active" });
    await Promise.resolve();
    controller.abort(abortReason);
    opening.reject(buildFailure);

    await Promise.all([
      expect(canceled).rejects.toBe(abortReason),
      expect(active).rejects.toBe(buildFailure),
    ]);

    await expect(runtime.start(ctx)).resolves.toBeUndefined();
    expect(loadConfig).toHaveBeenCalledTimes(2);
    expect(openOkf).toHaveBeenCalledTimes(2);
  });

  it("does not mask a failed build for an active signalled caller", async () => {
    const opening = deferred<OkfSearch>();
    const buildFailure = new Error("opening failed");
    const controller = new AbortController();
    const loadConfig = vi.fn(() => ({ root }));
    const openOkf = vi.fn(() => opening.promise);
    const runtime = createRuntime({ loadConfig, openOkf });

    const searching = runtime.search(
      ctx,
      { query: "needle" },
      controller.signal,
    );
    await Promise.resolve();
    opening.reject(buildFailure);

    await expect(searching).rejects.toBe(buildFailure);
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(openOkf).toHaveBeenCalledTimes(1);
  });

  it("honors cancellation on a cached snapshot before searching", async () => {
    const searches: string[] = [];
    const handle: OkfSearch = {
      ...unusedHandle,
      search(query) {
        searches.push(query);
        return [];
      },
    };
    const loadConfig = vi.fn(() => ({ root }));
    const openOkf = vi.fn(async () => handle);
    const runtime = createRuntime({ loadConfig, openOkf });

    await runtime.start(ctx);
    const reason = new Error("cached caller canceled");
    const controller = new AbortController();
    controller.abort(reason);

    await expect(
      runtime.search(ctx, { query: "needle" }, controller.signal),
    ).rejects.toBe(reason);
    expect(searches).toEqual([]);
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(openOkf).toHaveBeenCalledTimes(1);
  });

  it("trims the query and supplies only the default limit", async () => {
    const calls: Array<{
      query: string;
      options?: OkfSearchOptions;
    }> = [];
    const handle: OkfSearch = {
      ...unusedHandle,
      search(query, options) {
        calls.push({ query, options });
        return [];
      },
    };
    const runtime = createRuntime({
      loadConfig: () => ({ root }),
      openOkf: async () => handle,
    });

    await expect(
      runtime.search(ctx, { query: "  needle  " }),
    ).resolves.toEqual([]);

    const call = calls[0]!;
    expect(call.query).toBe("needle");
    expect(call.options).toStrictEqual({ limit: 5 });
    expect(Object.hasOwn(call.options!, "match")).toBe(false);
    expect(Object.hasOwn(call.options!, "fields")).toBe(false);
    expect(Object.hasOwn(call.options!, "fuzzy")).toBe(false);
    expect(Object.hasOwn(call.options!, "where")).toBe(false);
    expect(Object.hasOwn(call.options!, "asOf")).toBe(false);
  });

  it("preserves supplied options, including false and an empty where", async () => {
    const calls: Array<{
      query: string;
      options?: OkfSearchOptions;
    }> = [];
    const handle: OkfSearch = {
      ...unusedHandle,
      search(query, options) {
        calls.push({ query, options });
        return [];
      },
    };
    const runtime = createRuntime({
      loadConfig: () => ({ root }),
      openOkf: async () => handle,
    });
    const fields = ["title", "body"] as const;
    const where = {};
    const request: RuntimeSearchRequest = {
      query: "  needle  ",
      limit: 2,
      match: "all",
      fields,
      fuzzy: false,
      where,
    };
    const before = {
      ...request,
      fields: [...request.fields!],
      where: { ...request.where },
    };

    await runtime.search(ctx, request);

    const call = calls[0]!;
    expect(call).toStrictEqual({
      query: "needle",
      options: {
        limit: 2,
        match: "all",
        fields,
        fuzzy: false,
        where,
      },
    });
    expect(Object.hasOwn(call.options!, "asOf")).toBe(false);
    expect(request).toStrictEqual(before);
    expect(call.options!.fields).toBe(fields);
    expect(call.options!.where).toBe(where);
  });

  it("projects hits without changing their order", async () => {
    const hits: OkfSearchHit[] = [
      {
        documentId: "second",
        title: "Second",
        sectionId: "second#heading",
        score: 4,
        matchedFields: ["heading", "body"],
        headingPath: "Guide > Second",
        path: "guides/second.md",
        startLine: 8,
        endLine: 10,
        snippet: "second snippet",
      },
      {
        documentId: "first",
        title: "First",
        sectionId: "first",
        score: 9,
        matchedFields: ["title"],
        headingPath: "",
        path: "first.md",
        startLine: 1,
        endLine: 3,
        snippet: "first snippet",
      },
    ];
    const handle: OkfSearch = {
      ...unusedHandle,
      search: () => hits,
    };
    const runtime = createRuntime({
      loadConfig: () => ({ root }),
      openOkf: async () => handle,
    });

    const result = await runtime.search(ctx, { query: "needle" });

    expect(result).toStrictEqual([
      {
        title: "Second",
        headingPath: "Guide > Second",
        absolutePath: resolve(root, "guides/second.md"),
        startLine: 8,
        endLine: 10,
        matchedFields: ["heading", "body"],
        snippet: "second snippet",
      },
      {
        title: "First",
        headingPath: "",
        absolutePath: resolve(root, "first.md"),
        startLine: 1,
        endLine: 3,
        matchedFields: ["title"],
        snippet: "first snippet",
      },
    ]);
    expect(Object.keys(result[0]!).sort()).toStrictEqual([
      "absolutePath",
      "endLine",
      "headingPath",
      "matchedFields",
      "snippet",
      "startLine",
      "title",
    ]);
    expect(Object.keys(result[1]!).sort()).toStrictEqual([
      "absolutePath",
      "endLine",
      "headingPath",
      "matchedFields",
      "snippet",
      "startLine",
      "title",
    ]);
  });

  it("retains a cached snapshot after a search failure", async () => {
    const failure = new TypeError("search failed");
    let searches = 0;
    const hit: OkfSearchHit = {
      documentId: "guide",
      title: "Guide",
      sectionId: "guide",
      score: 1,
      matchedFields: ["body"],
      headingPath: "Guide",
      path: "guide.md",
      startLine: 2,
      endLine: 2,
      snippet: "needle",
    };
    const handle: OkfSearch = {
      ...unusedHandle,
      search: () => {
        searches += 1;
        if (searches === 1) {
          throw failure;
        }
        return [hit];
      },
    };
    const loadConfig = vi.fn(() => ({ root }));
    const openOkf = vi.fn(async () => handle);
    const runtime = createRuntime({ loadConfig, openOkf });

    await runtime.start(ctx);
    await expect(runtime.search(ctx, { query: "needle" })).rejects.toBe(failure);
    await expect(runtime.search(ctx, { query: "needle" })).resolves.toEqual([
      {
        title: "Guide",
        headingPath: "Guide",
        absolutePath: resolve(root, "guide.md"),
        startLine: 2,
        endLine: 2,
        matchedFields: ["body"],
        snippet: "needle",
      },
    ]);
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(openOkf).toHaveBeenCalledTimes(1);
  });

  it("preserves Error, configuration cause, and OkfError fields", async () => {
    const configCause = new Error("settings cause");
    const configFailure = new Error("settings failed", { cause: configCause });
    const configRuntime = createRuntime({
      loadConfig: () => {
        throw configFailure;
      },
      openOkf: async () => unusedHandle,
    });

    await expect(configRuntime.start(ctx)).rejects.toBe(configFailure);
    expect(configFailure.cause).toBe(configCause);

    const openCause = new Error("parse cause");
    const openFailure = new OkfError("ERR_OKF_PARSE", "bad.md", {
      field: "title",
      cause: openCause,
    });
    const openRuntime = createRuntime({
      loadConfig: () => ({ root }),
      openOkf: async () => {
        throw openFailure;
      },
    });

    await expect(openRuntime.start(ctx)).rejects.toBe(openFailure);
    expect(openFailure).toMatchObject({
      code: "ERR_OKF_PARSE",
      path: "bad.md",
      field: "title",
    });
    expect(openFailure.cause).toBe(openCause);

    const searchFailure = new TypeError("invalid search input");
    const searchHandle: OkfSearch = {
      ...unusedHandle,
      search: () => {
        throw searchFailure;
      },
    };
    const searchRuntime = createRuntime({
      loadConfig: () => ({ root }),
      openOkf: async () => searchHandle,
    });

    await expect(
      searchRuntime.search(ctx, { query: "needle" }),
    ).rejects.toBe(searchFailure);
  });

  it("preserves non-Error opening and search failures", async () => {
    const openingFailure = { kind: "opening-failure" };
    const openingRuntime = createRuntime({
      loadConfig: () => ({ root }),
      openOkf: async () => {
        throw openingFailure;
      },
    });

    await expect(openingRuntime.start(ctx)).rejects.toBe(openingFailure);

    const searchFailure = Symbol("search-failure");
    const searchHandle: OkfSearch = {
      ...unusedHandle,
      search: () => {
        throw searchFailure;
      },
    };
    const searchRuntime = createRuntime({
      loadConfig: () => ({ root }),
      openOkf: async () => searchHandle,
    });

    await expect(
      searchRuntime.search(ctx, { query: "needle" }),
    ).rejects.toBe(searchFailure);
  });
});
