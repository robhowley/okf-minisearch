import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../extensions/okf-search/config.js";

const PACKAGE_KEY = "pi-okf-search";

let tempRoot: string;
let agentDir: string;
let cwd: string;
let trusted: boolean;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "pi-okf-search-"));
  agentDir = join(tempRoot, "agent");
  cwd = join(tempRoot, "project");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  trusted = true;
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(tempRoot, { recursive: true, force: true });
});

function writeSettings(scope: "global" | "project", value: unknown): string {
  const path =
    scope === "global"
      ? join(agentDir, "settings.json")
      : join(cwd, CONFIG_DIR_NAME, "settings.json");
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}

function config() {
  return loadConfig({ cwd, isProjectTrusted: () => trusted });
}

function captureError(run: () => unknown): Error {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Error);
  return thrown as Error;
}

describe("loadConfig", () => {
  it("loads a global root and resolves it from the agent directory", () => {
    writeSettings("global", { [PACKAGE_KEY]: { root: "knowledge" } });

    expect(config()).toEqual({ root: join(agentDir, "knowledge") });
  });

  it("selects the trusted project object and resolves it from the project settings directory", () => {
    writeSettings("global", { [PACKAGE_KEY]: { root: "global" } });
    writeSettings("project", { [PACKAGE_KEY]: { root: "../knowledge" } });

    expect(config()).toEqual({ root: join(cwd, "knowledge") });
  });

  it("replaces the whole global object with a present project object", () => {
    writeSettings("global", { [PACKAGE_KEY]: { root: "global" } });
    const projectPath = writeSettings("project", { [PACKAGE_KEY]: {} });

    expect(config).toThrow(`Invalid project "${PACKAGE_KEY}" configuration (${projectPath})`);
    expect(config).toThrow("requires a nonblank string \"root\"");
  });

  it("does not read project settings when the project is untrusted", () => {
    writeSettings("global", { [PACKAGE_KEY]: { root: "global" } });
    writeSettings("project", "{ malformed project json");
    trusted = false;

    expect(config()).toEqual({ root: join(agentDir, "global") });
  });

  it("keeps absolute global and project roots absolute", () => {
    const globalRoot = resolve(tempRoot, "global-knowledge");
    const projectRoot = resolve(tempRoot, "project-knowledge");
    writeSettings("global", { [PACKAGE_KEY]: { root: globalRoot } });

    expect(config()).toEqual({ root: globalRoot });

    writeSettings("project", { [PACKAGE_KEY]: { root: projectRoot } });
    expect(config()).toEqual({ root: projectRoot });
  });

  it.each([null, [], "root", 1])("rejects a nonobject package section: %j", (section) => {
    const path = writeSettings("global", { [PACKAGE_KEY]: section });

    expect(config).toThrow(`Invalid global "${PACKAGE_KEY}" configuration (${path})`);
    expect(config).toThrow("must be an object");
  });

  it.each([undefined, null, 1, "", "   "])("rejects a missing, nonstring, or blank root: %j", (root) => {
    const section = root === undefined ? {} : { root };
    writeSettings("global", { [PACKAGE_KEY]: section });

    expect(config).toThrow("requires a nonblank string \"root\"");
  });

  it("rejects unknown package-object keys", () => {
    writeSettings("global", { [PACKAGE_KEY]: { root: "knowledge", extra: true } });

    expect(config).toThrow("contains unknown key(s): extra");
  });

  it("allows unrelated unknown top-level settings keys", () => {
    writeSettings("global", {
      unrelatedExtension: { arbitrary: true },
      [PACKAGE_KEY]: { root: "knowledge" },
    });

    expect(config()).toEqual({ root: join(agentDir, "knowledge") });
  });

  it("reports an actionable error when neither scope configures the package", () => {
    writeSettings("global", { theme: "dark" });
    writeSettings("project", { theme: "light" });

    expect(config).toThrow(`Missing "${PACKAGE_KEY}" configuration`);
    expect(config).toThrow(`Add {"${PACKAGE_KEY}":{"root":"..."}}`);
  });

  it("blocks global fallback on a project load error", () => {
    writeSettings("global", { [PACKAGE_KEY]: { root: "global" } });
    const projectPath = writeSettings("project", "{ malformed project json");

    const error = captureError(config);
    expect(error.message).toContain(`Failed to load project settings (${projectPath})`);
    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect(error.message).toContain((error.cause as Error).message);
  });

  it("reports a global load error when no project package object is selected", () => {
    const globalPath = writeSettings("global", "{ malformed global json");
    writeSettings("project", { theme: "light" });

    const error = captureError(config);
    expect(error.message).toContain(`Failed to load global settings (${globalPath})`);
    expect(error.cause).toBeInstanceOf(SyntaxError);
    expect(error.message).toContain((error.cause as Error).message);
  });

  it.each([
    ["null", null],
    ["missing its root", {}],
    ["containing an unknown key", { root: "knowledge", extra: true }],
  ])("does not ignore a global load error for a project value that is %s", (_description, section) => {
    const globalPath = writeSettings("global", "{ malformed global json");
    writeSettings("project", { [PACKAGE_KEY]: section });

    const error = captureError(config);
    expect(error.message).toContain(`Failed to load global settings (${globalPath})`);
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it("ignores a global load error when a valid project package object is selected", () => {
    writeSettings("global", "{ malformed global json");
    writeSettings("project", { [PACKAGE_KEY]: { root: "knowledge" } });

    expect(config()).toEqual({ root: join(cwd, CONFIG_DIR_NAME, "knowledge") });
  });

  it("creates a fresh settings manager on each call", () => {
    writeSettings("global", { [PACKAGE_KEY]: { root: "first" } });
    expect(config()).toEqual({ root: join(agentDir, "first") });

    writeSettings("global", { [PACKAGE_KEY]: { root: "second" } });
    expect(config()).toEqual({ root: join(agentDir, "second") });
  });
});
