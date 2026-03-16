import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as ts from "typescript";
import {
  findServiceFiles,
  loadConfig,
  readServiceMeta,
  generateTypesFile,
  ServiceMeta,
  PACKAGE_ROOT,
  PROJECT_ROOT,
} from "./utils.mjs";

const TYPES_SRC = path.join(PACKAGE_ROOT, "src/types/service.ts");
const CLIENT_DIR = path.join(PACKAGE_ROOT, "build/generated");
const CLIENT_FILE = path.join(CLIENT_DIR, "client.ts");
const TYPES_FILE = path.join(CLIENT_DIR, "types.ts");
const SRC_ROOT = PACKAGE_ROOT;

interface EnrichedMeta extends ServiceMeta {
  reqName: string;
  resName: string;
}

function generateClientFile(metas: EnrichedMeta[]): string {
  // Build type import list
  const typeNames: string[] = [];
  for (const m of metas) {
    typeNames.push(m.reqName, m.resName);
  }
  typeNames.push("RpcResponse");

  const importTypes = typeNames.join(", ");

  // Build trees
  const rpcRoot: Record<string, any> = {};
  const crudRoot: Record<string, any> = {};

  const addToTree = (tree: any, parts: string[], leaf: any) => {
    let current = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part]) current[part] = {};
      current = current[part];
    }
    current[parts[parts.length - 1]] = leaf;
  };

  for (const m of metas) {
    if (m.httpPath) {
      const pathParts = m.httpPath
        .split("/")
        .filter((p) => p && !p.startsWith(":"));
      addToTree(crudRoot, [...pathParts, m.httpMethod.toLowerCase()], m);
    } else {
      addToTree(rpcRoot, m.rpcMethod.split("."), m);
    }
  }

  const generateTreeCode = (tree: any, indent = "  "): string => {
    let code = "{\n";
    for (const key in tree) {
      const val = tree[key];
      if (val.rpcMethod !== undefined) {
        const m = val as EnrichedMeta;
        if (m.httpPath) {
          code += `${indent}  ${key}: async (params: ${m.reqName}): Promise<${m.resName}> => {\n`;
          let pathExpr = `"${m.httpPath}"`;
          const pathParams = m.httpPath.match(/:[a-zA-Z0-9]+/g) || [];
          if (pathParams.length > 0) {
            code += `${indent}    let p = ${pathExpr};\n`;
            for (const param of pathParams) {
              code += `${indent}    p = p.replace("${param}", (params as any).${param.slice(1)});\n`;
            }
            pathExpr = "p";
          }
          const urlExpr = `${pathExpr}.startsWith('/') ? ${pathExpr}.slice(1) : ${pathExpr}`;
          const kyCall =
            m.httpMethod === "GET" || m.httpMethod === "HEAD"
              ? `this.api.${m.httpMethod.toLowerCase()}(${urlExpr}).json<any>()`
              : `this.api.${m.httpMethod.toLowerCase()}(${urlExpr}, { json: params }).json<any>()`;
          code += `${indent}    const res = await ${kyCall};\n`;
          code += `${indent}    return res;\n`;
          code += `${indent}  },\n`;
        } else {
          code += `${indent}  ${key}: async (params: ${m.reqName}): Promise<RpcResponse<${m.resName}>> => {\n`;
          code += `${indent}    const res = await this.api.post('rpc', {\n`;
          code += `${indent}      json: { method: "${m.rpcMethod}", params, token: this.token }\n`;
          code += `${indent}    }).json<any>();\n`;
          code += `${indent}    return res;\n`;
          code += `${indent}  },\n`;
        }
      } else {
        code += `${indent}  ${key}: ${generateTreeCode(val, indent + "  ")},\n`;
      }
    }
    code += `${indent}}`;
    return code;
  };

  return `// AUTO-GENERATED — do not edit by hand
import ky from 'ky';
import type { ${importTypes} } from './types';

export interface ClientConfig {
  baseUrl: string;
  token?: string;
}

export class ServiceClient {
  private api: typeof ky;
  private token?: string;

  constructor(config: ClientConfig) {
    this.token = config.token;
    this.api = ky.create({
      prefixUrl: config.baseUrl,
      throwHttpErrors: false,
      hooks: {
        beforeRequest: [
          (request) => {
            if (this.token) {
              request.headers.set('Authorization', \`Bearer \${this.token}\`);
            }
          },
        ],
      },
    });
  }

  setToken(token: string) {
    this.token = token;
  }

  public readonly rpc = ${generateTreeCode(rpcRoot, "  ")};

  public readonly crud = ${generateTreeCode(crudRoot, "  ")};
}

export function init(config: ClientConfig) {
  return new ServiceClient(config);
}
`;
}

// ---------------------------------------------------------------------------
// 6. Orchestrate
// ---------------------------------------------------------------------------

function generateClient() {
  const config = loadConfig();
  const serviceDirs = config.serviceDirectories;
  const serviceFiles: string[] = [];

  if (!serviceDirs || serviceDirs.length === 0) {
    console.error("No service directories specified in config.");
    process.exit(1);
  }

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
    console.warn("No service files found in specified directories.");
    return;
  }

  // Create TS program that includes both service files and the shared types file
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

  // Build metadata (parse method/path/etc. from file text)
  const metas = readServiceMeta(serviceFiles, checker, program);
  if (metas.length === 0) {
    console.warn(
      "No services with a `method:` field found. Nothing to generate.",
    );
    return;
  }

  // 1. Generate types.ts (using common logic)
  const typesContent = generateTypesFile(
    metas,
    checker,
    program,
    SRC_ROOT,
    printer,
    TYPES_SRC,
  );

  // 2. Generate client.ts
  const enriched: EnrichedMeta[] = metas.map((m) => ({
    ...m,
    reqName: `Req_${m.index}`,
    resName: `Res_${m.index}`,
  }));
  const clientContent = generateClientFile(enriched);

  // Write output
  if (!fs.existsSync(CLIENT_DIR)) {
    fs.mkdirSync(CLIENT_DIR, { recursive: true });
  }

  // Clean up old per-service copied files if they exist
  for (const file of fs.readdirSync(CLIENT_DIR)) {
    if (
      file.endsWith(".ts") &&
      file !== "client.ts" &&
      file !== "types.ts" &&
      file !== "registry.ts"
    ) {
      fs.rmSync(path.join(CLIENT_DIR, file));
      console.log("Removed stale file:", file);
    }
  }

  fs.writeFileSync(TYPES_FILE, typesContent);
  console.log("Types generated at:", TYPES_FILE);

  fs.writeFileSync(CLIENT_FILE, clientContent);
  console.log("Client generated at:", CLIENT_FILE);

  // Optional: sync to external directory
  const syncDir = config.clientOutDir || process.env.CLIENT_OUT_DIR;
  if (syncDir) {
    const absSyncDir = path.isAbsolute(syncDir)
      ? syncDir
      : path.resolve(PROJECT_ROOT, syncDir);
    try {
      if (!fs.existsSync(absSyncDir)) {
        fs.mkdirSync(absSyncDir, { recursive: true });
        console.log(`Created client output directory: ${absSyncDir}`);
      }
      fs.writeFileSync(path.join(absSyncDir, "client.ts"), clientContent);
      fs.writeFileSync(path.join(absSyncDir, "types.ts"), typesContent);
      console.log(`🚀 Client synced to external directory: ${absSyncDir}`);
    } catch (err: any) {
      console.error(`Failed to sync client to ${absSyncDir}:`, err.message);
    }
  }
}

generateClient();
