import esbuild from "esbuild";
import * as path from "path";
import * as fs from "fs";
import { PACKAGE_ROOT, PROJECT_ROOT, loadConfig } from "./utils.mjs";

async function build() {
  const config = loadConfig();

  // Determine entry point and outfile
  // Defaults for internal build or project build
  let entryPoint = config.edgeEntry
    ? path.resolve(PROJECT_ROOT, config.edgeEntry)
    : path.join(PROJECT_ROOT, "src/index.ts");

  let outFile = config.edgeOutFile
    ? path.resolve(PROJECT_ROOT, config.edgeOutFile)
    : path.join(PROJECT_ROOT, "dist/index.js");

  const isInternal = PROJECT_ROOT === PACKAGE_ROOT;

  if (isInternal && !config.edgeEntry) {
    entryPoint = path.join(PACKAGE_ROOT, "build/tsc/src/index.js");
  }

  if (!fs.existsSync(entryPoint)) {
    // If default src/index.ts doesn't exist and no config, maybe it's an error if we are trying to bundle
    if (config.edgeEntry) {
      console.error(`Edge entry point not found: ${entryPoint}`);
      process.exit(1);
    }
    console.log(`No edge entry point found at ${entryPoint}, skipping bundle.`);
    return;
  }

  const alias: Record<string, string> = {};

  // If we are in a project that uses crunch.ts and has tsOutDir,
  // we want to alias 'crunch.ts' to the generated index.ts
  if (config.tsOutDir) {
    const tsOutDirAbs = path.isAbsolute(config.tsOutDir)
      ? config.tsOutDir
      : path.resolve(PROJECT_ROOT, config.tsOutDir);
    alias["crunch.ts"] = path.join(tsOutDirAbs, "index.ts");
    console.log(`- Aliasing 'crunch.ts' to ${alias["crunch.ts"]}`);
  }

  // Internal build uses @generated/registry alias
  if (isInternal) {
    alias["@generated/registry"] = path.join(
      PACKAGE_ROOT,
      "build/tsc/build/generated/registry.js",
    );
  }

  console.log(`🚀 Bundling edge script: ${entryPoint} -> ${outFile}`);

  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    minify: true,
    outfile: outFile,
    format: "esm",
    target: ["es2022"],
    platform: "browser",
    // Use project tsconfig if available, otherwise package tsconfig
    tsconfig: fs.existsSync(path.join(PROJECT_ROOT, "tsconfig.json"))
      ? path.join(PROJECT_ROOT, "tsconfig.json")
      : path.join(PACKAGE_ROOT, "tsconfig.json"),
    alias,
    external: ["@bunny.net/edgescript-sdk"], // SDK is provided by the environment
  });

  console.log(
    `✅ Edge bundle generated: ${path.relative(PROJECT_ROOT, outFile)}`,
  );
}

build().catch((err) => {
  console.error("Bundle failed:", err.message);
  process.exit(1);
});
