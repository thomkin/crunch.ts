import * as fs from "fs";
import * as path from "path";

import { fileURLToPath } from "url";
import {
  findServiceFiles,
  loadConfig,
  readServiceMeta,
  generateTypesFile,
  PACKAGE_ROOT,
  PROJECT_ROOT,
} from "./utils.mjs";
import * as ts from "typescript";

const GEN_DIR = path.join(PACKAGE_ROOT, "build/generated");
const REGISTRY_FILE = path.join(GEN_DIR, "registry.ts");
const TYPES_FILE = path.join(GEN_DIR, "types.ts");
const TYPES_SRC = path.join(PACKAGE_ROOT, "src/types/service.ts");
const SRC_ROOT = PACKAGE_ROOT;

function copyDir(src: string, dest: string) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function generateRegistry() {
  const config = loadConfig();
  const serviceDirs = config.serviceDirectories;

  if (!serviceDirs || serviceDirs.length === 0) {
    console.error("No service directories specified in config.");
    process.exit(1);
  }

  const serviceFiles: string[] = [];
  for (const relDir of serviceDirs) {
    const absDir = path.isAbsolute(relDir)
      ? relDir
      : path.resolve(PROJECT_ROOT, relDir);
    if (!fs.existsSync(absDir)) {
      console.warn(`Warning: Service directory does not exist: ${absDir}`);
      continue;
    }
    findServiceFiles(absDir, serviceFiles);
  }

  if (serviceFiles.length === 0) {
    console.warn("No service files found. Nothing to generate.");
    return;
  }

  // Create TS program
  const allFiles = [...serviceFiles, TYPES_SRC];
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
  };
  const program = ts.createProgram(allFiles, compilerOptions);
  const checker = program.getTypeChecker();
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

  const metas = readServiceMeta(serviceFiles, checker, program);

  // 1. Generate types.ts content
  const typesContent = generateTypesFile(
    metas,
    checker,
    program,
    SRC_ROOT,
    printer,
    TYPES_SRC,
  );

  const tsOutDir = config.tsOutDir
    ? path.isAbsolute(config.tsOutDir)
      ? config.tsOutDir
      : path.resolve(PROJECT_ROOT, config.tsOutDir)
    : null;

  if (tsOutDir) {
    console.log(`🚀 Generating TS output in: ${tsOutDir}`);
    if (!fs.existsSync(tsOutDir)) {
      fs.mkdirSync(tsOutDir, { recursive: true });
    }

    // 1. Copy src to tsOutDir/src
    const destSrc = path.join(tsOutDir, "src");
    copyDir(path.join(PACKAGE_ROOT, "src"), destSrc);

    // 1.1 Fix internal imports in the copied src
    const fixImports = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          fixImports(fullPath);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith(".ts") || entry.name.endsWith(".mts"))
        ) {
          let content = fs.readFileSync(fullPath, "utf-8");

          // 1. Fix internal registry import
          if (content.includes("../../build/generated/registry")) {
            const relToRoot = path.relative(path.dirname(fullPath), tsOutDir);
            const newImport = path
              .join(relToRoot, "registry.ts")
              .replace(/\\/g, "/");

            const adjustedImport = newImport.startsWith(".")
              ? newImport
              : "./" + newImport;

            console.log(
              "Thomas------------- adjusted imports --",
              adjustedImport,
            );
            content = content.replace(
              /import\s+{\s*ServiceRegistry\s*}\s*from\s*["']\.\.\/\.\.\/build\/generated\/registry["']/g,
              `import { ServiceRegistry } from "${adjustedImport}"`,
            );
          }

          // 2. Add .ts extensions to other relative imports
          content = content.replace(
            /(import|export)\s+([\s\S]*?from\s+)?["'](\.\.?\/.*?)["']/g,
            (match, p1, p2, p3) => {
              if (
                p3.endsWith(".ts") ||
                p3.endsWith(".mts") ||
                p3.endsWith(".js") ||
                p3.endsWith(".mjs") ||
                p3.endsWith(".json")
              ) {
                return match;
              }
              return `${p1} ${p2 ?? ""} "${p3}.ts"`;
            },
          );

          fs.writeFileSync(fullPath, content);
        }
      }
    };
    fixImports(destSrc);

    // 2. Copy services to tsOutDir/services
    const destServices = path.join(tsOutDir, "services");
    if (!fs.existsSync(destServices)) fs.mkdirSync(destServices);

    const serviceMap = new Map<number, string>(); // index -> relative path in destServices
    for (const meta of metas) {
      const fileName = `service_${meta.index}.ts`;
      const destPath = path.join(destServices, fileName);
      fs.copyFileSync(meta.filePath, destPath);
      serviceMap.set(meta.index, `./services/service_${meta.index}`);
    }

    // 3. Generate types.ts
    fs.writeFileSync(path.join(tsOutDir, "types.ts"), typesContent);

    // 4. Generate registry.ts
    let regCode = `import typia from 'typia';\n`;
    regCode += `import { RegisteredService } from './src/types/service.ts';\n`;
    regCode += `import { ${metas.map((m) => `Req_${m.index}`).join(", ")} } from './types.ts';\n\n`;

    for (const meta of metas) {
      const relPath = serviceMap.get(meta.index);
      regCode += `import { service as service_${meta.index} } from '${relPath}.ts';\n`;
    }

    regCode += `\nexport const ServiceRegistry: Record<string, RegisteredService> = {\n`;
    for (const meta of metas) {
      regCode += `  [service_${meta.index}.method]: {
    definition: service_${meta.index} as any,
    validate: (input: unknown) => typia.assert<Req_${meta.index}>(input)
  },\n`;
    }
    regCode += `};\n`;
    fs.writeFileSync(path.join(tsOutDir, "registry.ts"), regCode);

    // 5. Generate index.ts
    const indexCode = `export { handleRequest } from './src/handler.ts';\nexport { ServiceRegistry } from './registry.ts';\n`;
    fs.writeFileSync(path.join(tsOutDir, "index.ts"), indexCode);

    console.log("✅ TS output generated successfully.");
  } else {
    // Legacy behavior (internal build)
    // 2. Generate registry.ts
    let code = `import typia from 'typia';\n`;
    code += `import { RegisteredService } from '../../src/types/service';\n`;
    code += `import { ${metas.map((m) => `Req_${m.index}`).join(", ")} } from './types';\n\n`;

    // We still need to import the service handlers from their original files
    for (const meta of metas) {
      let relativePath = path.relative(
        path.dirname(REGISTRY_FILE),
        meta.filePath,
      );
      if (!relativePath.startsWith(".")) relativePath = "./" + relativePath;
      relativePath = relativePath.replace(/\.ts$/, "");
      code += `import { service as service_${meta.index} } from '${relativePath}';\n`;
    }

    code += `\nexport const ServiceRegistry: Record<string, RegisteredService> = {\n`;
    for (const meta of metas) {
      code += `  [service_${meta.index}.method]: {
    definition: service_${meta.index} as any,
    validate: (input: unknown) => typia.assert<Req_${meta.index}>(input)
  },\n`;
    }
    code += `};\n`;

    // Ensure generated directory exists
    if (!fs.existsSync(GEN_DIR)) {
      fs.mkdirSync(GEN_DIR, { recursive: true });
    }

    fs.writeFileSync(TYPES_FILE, typesContent);
    fs.writeFileSync(REGISTRY_FILE, code);

    console.log("✅ Registry and Types generated successfully.");
  }
}

generateRegistry();
