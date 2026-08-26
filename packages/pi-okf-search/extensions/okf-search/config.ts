import {
  CONFIG_DIR_NAME,
  SettingsManager,
  getAgentDir,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { join, resolve } from "node:path";

const PACKAGE_KEY = "pi-okf-search";

type ConfigContext = Pick<ExtensionContext, "cwd" | "isProjectTrusted">;

export interface OkfSearchConfig {
  root: string;
}

export function loadConfig(ctx: ConfigContext): OkfSearchConfig {
  const agentDir = getAgentDir();
  const projectTrusted = ctx.isProjectTrusted();
  const projectDir = join(ctx.cwd, CONFIG_DIR_NAME);
  const globalPath = join(agentDir, "settings.json");
  const projectPath = join(projectDir, "settings.json");
  const settings = SettingsManager.create(ctx.cwd, agentDir, { projectTrusted });
  const global = settings.getGlobalSettings() as Record<string, unknown>;
  const project = projectTrusted
    ? (settings.getProjectSettings() as Record<string, unknown>)
    : undefined;
  const errors = settings.drainErrors();
  const projectError = errors.find((error) => error.scope === "project");

  if (projectError) {
    throw loadError(projectError.scope, projectError.path ?? projectPath, projectError.error);
  }

  const globalError = errors.find((error) => error.scope === "global");
  const hasProjectConfig = project !== undefined && Object.hasOwn(project, PACKAGE_KEY);
  const projectValidationError = hasProjectConfig
    ? configValidationError(project[PACKAGE_KEY])
    : undefined;

  if (hasProjectConfig) {
    if (projectValidationError === undefined) {
      return resolveConfig(projectDir, project[PACKAGE_KEY]);
    }
    if (globalError) {
      throw loadError(globalError.scope, globalError.path ?? globalPath, globalError.error);
    }
    throw configError("project", projectPath, projectValidationError);
  }

  if (globalError) {
    throw loadError(globalError.scope, globalError.path ?? globalPath, globalError.error);
  }

  if (!Object.hasOwn(global, PACKAGE_KEY)) {
    const projectHint = projectTrusted
      ? ` or project settings (${projectPath})`
      : `; project settings (${projectPath}) are ignored until the project is trusted`;
    throw new Error(
      `Missing ${JSON.stringify(PACKAGE_KEY)} configuration in global settings (${globalPath})${projectHint}. Add {"${PACKAGE_KEY}":{"root":"..."}}.`,
    );
  }

  const globalValidationError = configValidationError(global[PACKAGE_KEY]);
  if (globalValidationError !== undefined) {
    throw configError("global", globalPath, globalValidationError);
  }

  return resolveConfig(agentDir, global[PACKAGE_KEY]);
}

function configValidationError(section: unknown): string | undefined {
  if (typeof section !== "object" || section === null || Array.isArray(section)) {
    return `must be an object containing only a nonblank string "root"`;
  }

  const unknownKeys = Object.keys(section).filter((key) => key !== "root");
  if (unknownKeys.length > 0) {
    return `contains unknown key(s): ${unknownKeys.join(", ")}`;
  }

  const root = (section as Record<string, unknown>).root;
  if (typeof root !== "string" || root.trim() === "") {
    return `requires a nonblank string "root"`;
  }

  return undefined;
}

function resolveConfig(baseDir: string, section: unknown): OkfSearchConfig {
  const root = (section as { root: string }).root;
  return { root: resolve(baseDir, root.trim()) };
}

function loadError(scope: "global" | "project", path: string, cause: Error): Error {
  return new Error(`Failed to load ${scope} settings (${path}): ${cause.message}`, { cause });
}

function configError(scope: "global" | "project", path: string, message: string): Error {
  return new Error(`Invalid ${scope} ${JSON.stringify(PACKAGE_KEY)} configuration (${path}): ${message}.`);
}
