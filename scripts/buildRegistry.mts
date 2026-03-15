import * as fs from "fs";
import * as path from "path";

import { fileURLToPath } from "url";
import {
  findServiceFiles,
  loadConfig,
  readServiceMeta,
  generateTypesFile,
} from "./utils.mjs";
import * as ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEN_DIR = path.join(__dirname, "../build/generated");
const REGISTRY_FILE = path.join(GEN_DIR, "registry.ts");
const TYPES_FILE = path.join(GEN_DIR, "types.ts");
const TYPES_SRC = path.join(__dirname, "../src/types/service.ts");
const SRC_ROOT = path.join(__dirname, "..");

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
      : path.resolve(__dirname, "..", relDir);
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

  // 1. Generate types.ts (Shared with client)
  const typesContent = generateTypesFile(
    metas,
    checker,
    program,
    SRC_ROOT,
    printer,
    TYPES_SRC,
  );

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

generateRegistry();
