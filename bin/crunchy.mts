#!/usr/bin/env tsx
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

console.log("RootDir", ROOT_DIR);

const args = process.argv.slice(2);
const command = args[0] || "build";

async function runCommand(
  cmd: string,
  args: string[],
  env: Record<string, string> = {},
) {
  // Use npx if available to ensure binaries like ts-patch, tsc are found
  const fullCmd = cmd;
  console.log(`> ${fullCmd} ${args.join(" ")}`);

  return new Promise<void>((resolve, reject) => {
    const child = spawn(fullCmd, args, {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, ...env },
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
}

async function main() {
  console.log("thomas", process.cwd());
  const configPath = path.resolve(process.cwd(), "crunchy.json");
  const env = {
    CRUNCH_CFG: fs.existsSync(configPath) ? configPath : "",
  };

  console.log("ENV ,", env);

  try {
    switch (command) {
      case "build:registry":
        await runCommand(
          "tsx",
          [path.join(ROOT_DIR, "scripts/buildRegistry.mts")],
          env,
        );
        break;
      case "build:client":
        await runCommand(
          "tsx",
          [path.join(ROOT_DIR, "scripts/buildClient.mts")],
          env,
        );
        break;
      case "build:edge":
      case "bundle":
        await runCommand(
          "tsx",
          [path.join(ROOT_DIR, "scripts/build.mts")],
          env,
        );
        break;
      case "build":
        console.log("🚀 Starting full crunch build...");
        console.log(`- Project: ${process.cwd()}`);
        console.log(`- Config:  ${env.CRUNCH_CFG || "default"}`);

        const config = fs.existsSync(configPath)
          ? JSON.parse(fs.readFileSync(configPath, "utf-8"))
          : {};

        // Clean up internal generated files (needed for fresh framework build)
        const INT_GEN_DIR = path.join(ROOT_DIR, "build/generated");
        if (fs.existsSync(INT_GEN_DIR)) {
          console.log("- Cleaning internal generated files...");
          fs.rmSync(INT_GEN_DIR, { recursive: true, force: true });
        }

        // Clean PROJECT dist
        const PROJECT_DIST = path.join(process.cwd(), "dist");
        if (fs.existsSync(PROJECT_DIST)) {
          console.log("- Cleaning project dist folder...");
          fs.rmSync(PROJECT_DIST, { recursive: true, force: true });
        }

        await runCommand(
          "tsx",
          [path.join(ROOT_DIR, "scripts/buildRegistry.mts")],
          env,
        );

        // if (config.tsOutDir) {
        //   console.log("- tsOutDir detected, skipping internal bundling steps.");
        // } else {
        //   await runCommand("npx", ["ts-patch", "install", "-s"], env);
        //   await runCommand(
        //     "npx",
        //     ["tsc", "-p", path.join(ROOT_DIR, "tsconfig.json")],
        //     env,
        //   );
        //   await runCommand(
        //     "tsx",
        //     [path.join(ROOT_DIR, "scripts/build.mts")],
        //     env,
        //   );
        // }

        // await runCommand(
        //   "tsx",
        //   [path.join(ROOT_DIR, "scripts/buildClient.mts")],
        //   env,
        // );

        // If it's an external project (tsOutDir set), check if we should also bundle the project
        // if (config.tsOutDir) {
        //   const edgeEntry = config.edgeEntry
        //     ? path.resolve(process.cwd(), config.edgeEntry)
        //     : path.join(process.cwd(), "src/index.ts");

        //   if (fs.existsSync(edgeEntry)) {
        //     console.log("- Project entry point found, bundling...");
        //     await runCommand(
        //       "tsx",
        //       [path.join(ROOT_DIR, "scripts/build.mts")],
        //       env,
        //     );
        //   }
        // }

        console.log("✅ Build complete!");
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.log(
          "Usage: crunchy [build|bundle|build:registry|build:client|build:edge]",
        );
        process.exit(1);
    }
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
