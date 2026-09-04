#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildNativeFacade } from "./build-facade.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const napiManifestPath = require.resolve("@napi-rs/cli/package.json");
const napiManifest = JSON.parse(readFileSync(napiManifestPath, "utf8"));
const napiCli = resolve(dirname(napiManifestPath), napiManifest.bin.napi);

function fail(message) {
  throw new Error(message);
}

export function parseBuildArguments(args) {
  const options = { release: false, target: undefined, useNapiCross: false };
  const seen = new Set();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--release") {
      if (seen.has("release")) fail("--release may only be specified once");
      seen.add("release");
      options.release = true;
      continue;
    }
    if (argument === "--target") {
      if (seen.has("target")) fail("--target may only be specified once");
      const target = args[index + 1];
      if (!target || target.startsWith("--")) fail("--target requires one target triple");
      seen.add("target");
      options.target = target;
      index += 1;
      continue;
    }
    if (argument.startsWith("--use-napi-cross=")) {
      if (seen.has("use-napi-cross")) fail("--use-napi-cross may only be specified once");
      const value = argument.slice("--use-napi-cross=".length);
      if (value !== "true" && value !== "false") fail("--use-napi-cross must be true or false");
      seen.add("use-napi-cross");
      options.useNapiCross = value === "true";
      continue;
    }
    fail(`unknown native build argument: ${argument}`);
  }

  return options;
}

export async function buildNativePackage(
  { release = false, target, useNapiCross = false } = {},
  { runCommand = spawnSync, buildFacade = buildNativeFacade } = {},
) {
  const args = ["build", "--platform"];
  if (release) args.push("--release");
  args.push("--js", "native.cjs", "--dts", "native.d.cts");
  if (target) args.push("--target", target);
  if (useNapiCross) args.push("--use-napi-cross");
  args.push("--", "--locked");

  const result = runCommand(process.execPath, [napiCli, ...args], {
    cwd: packageRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`napi ${args.join(" ")} exited with ${result.status}`);

  await buildFacade();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await buildNativePackage(parseBuildArguments(process.argv.slice(2)));
}
