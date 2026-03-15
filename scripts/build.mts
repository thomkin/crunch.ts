import esbuild from "esbuild";

async function build() {
  await esbuild.build({
    entryPoints: ["build/tsc/src/index.js"],
    bundle: true,
    minify: true,
    outfile: "dist/index.js",
    format: "esm",
    target: ["es2022"],
    platform: "browser", // Edge environments are similar to web workers
    tsconfig: "tsconfig.json",
    alias: {
      "@generated/registry": "./build/tsc/build/generated/registry.js",
    },
  });
  console.log("✅ Edge bundle generated: dist/index.js");
}

build().catch(() => process.exit(1));
