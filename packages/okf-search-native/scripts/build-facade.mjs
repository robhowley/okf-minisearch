import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { rollup } from "rollup";
import { dts } from "rollup-plugin-dts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const entrypoint = join(packageRoot, "src", "index.ts");
const outputDirectory = join(packageRoot, "dist");
const nativeSpecifier = "../native.cjs";
const privateEntries = new Map([
  [
    "@okf-internal/prepare",
    join(repositoryRoot, "packages", "okf-prepare", "src", "index.ts"),
  ],
  [
    "@okf-internal/prepare/node",
    join(repositoryRoot, "packages", "okf-prepare", "src", "node.ts"),
  ],
]);

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const [format, outfile] of [
  ["esm", "index.mjs"],
  ["cjs", "index.cjs"],
]) {
  await build({
    entryPoints: [entrypoint],
    outfile: join(outputDirectory, outfile),
    bundle: true,
    packages: "bundle",
    platform: "node",
    format,
    target: "node22",
    external: [nativeSpecifier],
    plugins: [privateSourcePlugin()],
    legalComments: "none",
    logLevel: "silent",
    sourcemap: false,
    ...(format === "esm" ? {
      banner: {
        js: 'import { createRequire as __okfCreateRequire } from "node:module"; const require = __okfCreateRequire(import.meta.url);',
      },
    } : {}),
  });
}

const declarationBundle = await rollup({
  input: entrypoint,
  external: (id) => id === nativeSpecifier,
  plugins: [privateDeclarationSourcePlugin(), dts({ respectExternal: false })],
  onwarn(warning) {
    throw new Error(`Rollup warning: ${warning.message}`);
  },
});

let declaration;
try {
  const generated = await declarationBundle.generate({ format: "es" });
  const chunk = generated.output.find((output) => output.type === "chunk");
  if (!chunk) {
    throw new Error("Declaration bundling produced no output");
  }
  declaration = chunk.code;
} finally {
  await declarationBundle.close();
}

await Promise.all([
  writeFile(join(outputDirectory, "index.d.mts"), declaration),
  writeFile(join(outputDirectory, "index.d.cts"), declaration),
  writeFile(join(outputDirectory, "index.d.ts"), declaration),
]);

for (const filename of [
  "index.mjs",
  "index.cjs",
  "index.d.mts",
  "index.d.cts",
  "index.d.ts",
]) {
  const contents = await readFile(join(outputDirectory, filename), "utf8");
  if (contents.includes("@okf-internal/prepare") || contents.includes("workspace:")) {
    throw new Error(`${filename} contains a private workspace reference`);
  }
}

function privateSourcePlugin() {
  return {
    name: "resolve-private-prepare-source",
    setup(build) {
      build.onResolve({ filter: /^@okf-internal\/prepare(?:\/node)?$/ }, (args) => {
        const path = privateEntries.get(args.path);
        return path ? { path } : undefined;
      });
    },
  };
}

function privateDeclarationSourcePlugin() {
  return {
    name: "resolve-private-prepare-declarations",
    resolveId(id) {
      return privateEntries.get(id) ?? null;
    },
  };
}
