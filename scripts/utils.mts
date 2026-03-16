import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PACKAGE_ROOT = path.resolve(__dirname, "..");
export const PROJECT_ROOT = process.cwd();

export interface Config {
  serviceDirectories?: string[];
  clientOutDir?: string;
  tsOutDir?: string;
  edgeEntry?: string;
  edgeOutFile?: string;
}

export function loadConfig(): Config {
  // Priority: 1. ENV, 2. Local crunchy.json, 3. Local crunchy.config.json
  const cfgPath = process.env.CRUNCH_CFG || "crunchy.json";
  const absPath = path.isAbsolute(cfgPath)
    ? cfgPath
    : path.resolve(PROJECT_ROOT, cfgPath);

  if (fs.existsSync(absPath)) {
    try {
      return JSON.parse(fs.readFileSync(absPath, "utf-8"));
    } catch (err: any) {
      console.warn(`Failed to parse config at ${absPath}: ${err.message}.`);
    }
  }

  return {};
}

export function findServiceFiles(
  dir: string,
  fileList: string[] = [],
): string[] {
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findServiceFiles(filePath, fileList);
    } else if (file.endsWith(".ts") && !file.endsWith(".test.ts")) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

export interface ServiceMeta {
  index: number;
  filePath: string;
  rpcMethod: string;
  httpPath: string | null;
  httpMethod: string;
}

export function readServiceMeta(
  files: string[],
  checker: ts.TypeChecker,
  program: ts.Program,
): ServiceMeta[] {
  const metas: ServiceMeta[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    const text = sf.getFullText();
    const methodMatch = text.match(/method:\s*"([^"]+)"/);
    if (!methodMatch) continue;
    const pathMatch = text.match(/path:\s*"([^"]+)"/);
    const httpMethodMatch = text.match(/httpMethod:\s*"([^"]+)"/);
    metas.push({
      index: i,
      filePath: file,
      rpcMethod: methodMatch[1],
      httpPath: pathMatch ? pathMatch[1] : null,
      httpMethod: (httpMethodMatch ? httpMethodMatch[1] : "POST").toUpperCase(),
    });
  }
  return metas;
}

export function collectTypeDeclarations(
  type: ts.Type,
  checker: ts.TypeChecker,
  rootDir: string,
  visited: Set<ts.Declaration> = new Set(),
): ts.Declaration[] {
  const result: ts.Declaration[] = [];
  const enqueue = (t: ts.Type) => {
    if (!t) return;

    // Handle union and intersection types
    if (t.isUnionOrIntersection()) {
      for (const sub of t.types) enqueue(sub);
    }

    // Handle generic references (like Array<T>)
    if ((t as any).objectFlags & ts.ObjectFlags.Reference) {
      const typeArgs = checker.getTypeArguments(t as ts.TypeReference);
      for (const arg of typeArgs) enqueue(arg);
    }

    const symbol = t.aliasSymbol ?? t.getSymbol();
    if (!symbol) return;

    const declarations = symbol.getDeclarations() ?? [];
    for (const decl of declarations) {
      if (
        decl.getFullText().includes("Array<T>") ||
        decl.getFullText().includes("Array:")
      )
        continue;

      fs.writeFileSync(
        path.resolve("/tmp/crunch_test.txt"),
        decl.getFullText(),
        {
          flag: "a",
        },
      );

      if (visited.has(decl)) continue;
      const sf = decl.getSourceFile();
      if (!sf) continue;
      const declFile = path.resolve(sf.fileName);
      const isInternal =
        declFile.startsWith(PACKAGE_ROOT) || declFile.startsWith(PROJECT_ROOT);

      // Skip non-internal node_modules and built-in libs
      if (
        !isInternal &&
        (declFile.includes("node_modules") || declFile.includes(".pnpm"))
      )
        continue;
      if (declFile.includes("lib.d.ts") || declFile.includes("lib.esnext.d.ts"))
        continue;

      visited.add(decl);
      result.push(decl);

      const innerType = checker.getDeclaredTypeOfSymbol(symbol);
      for (const prop of innerType.getProperties()) {
        const propType = checker.getTypeOfSymbol(prop);
        enqueue(propType);
      }
      if (t.aliasTypeArguments) {
        for (const arg of t.aliasTypeArguments) enqueue(arg);
      }
      if (innerType.isClassOrInterface()) {
        for (const base of checker.getBaseTypes(
          innerType as ts.InterfaceType,
        )) {
          enqueue(base);
        }
      }
    }
  };
  enqueue(type);
  return result;
}

export function printDeclaration(
  decl: ts.Declaration,
  printer: ts.Printer,
): string {
  const sf = decl.getSourceFile();
  return printer.printNode(ts.EmitHint.Unspecified, decl, sf);
}

export function printRenamedDeclaration(
  decl: ts.Declaration,
  checker: ts.TypeChecker,
  printer: ts.Printer,
  renameMap: Map<ts.Declaration, string>,
): string {
  const transformer = (context: ts.TransformationContext) => {
    const visit = (node: ts.Node): ts.Node => {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol) {
          const decls = symbol.getDeclarations();
          if (decls) {
            for (const d of decls) {
              const mappedName = renameMap.get(d);
              if (mappedName) {
                return ts.factory.createIdentifier(mappedName);
              }
            }
          }
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (node: ts.Node) => ts.visitNode(node, visit);
  };

  const result = ts.transform(decl, [transformer]);
  const transformed = result.transformed[0] as ts.Declaration;
  const output = printer.printNode(
    ts.EmitHint.Unspecified,
    transformed,
    decl.getSourceFile(),
  );
  result.dispose();
  return output;
}

const CLIENT_VISIBLE_SERVICE_TYPES = new Set([
  "RpcErrorCode",
  "RpcResponse",
  "HttpMethod",
]);

export function generateTypesFile(
  metas: ServiceMeta[],
  checker: ts.TypeChecker,
  program: ts.Program,
  rootDir: string,
  printer: ts.Printer,
  typesSrc: string,
): string {
  const lines: string[] = [
    "// AUTO-GENERATED — do not edit by hand",
    "// This file contains all types needed by the generated client.",
    "",
  ];

  const serviceTypeSf = program.getSourceFile(typesSrc);
  if (!serviceTypeSf) {
    throw new Error(`Cannot find source file: ${typesSrc}`);
  }
  lines.push(
    "// ── Shared service types ───────────────────────────────────────────────────",
  );

  const renameMap = new Map<ts.Declaration, string>();
  const sharedGlobalDecls = new Set<ts.Declaration>();

  ts.forEachChild(serviceTypeSf, (node) => {
    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isTypeAliasDeclaration(node)
    ) {
      if (CLIENT_VISIBLE_SERVICE_TYPES.has(node.name.text)) {
        lines.push(printDeclaration(node, printer));
        sharedGlobalDecls.add(node);
        renameMap.set(node, node.name.text);
      }
    }
  });
  lines.push("");

  const processed = new Set<ts.Declaration>(sharedGlobalDecls);
  const serviceDecls: { meta: ServiceMeta; decls: ts.Declaration[] }[] = [];

  for (const meta of metas) {
    const sf = program.getSourceFile(meta.filePath);
    if (!sf) continue;

    const reqDecl = sf.statements.find(
      (s) =>
        (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) &&
        (s.name as any).text === "Request",
    ) as ts.Declaration | undefined;
    const resDecl = sf.statements.find(
      (s) =>
        (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) &&
        (s.name as any).text === "Response",
    ) as ts.Declaration | undefined;

    const currentServiceDecls: ts.Declaration[] = [];
    const startDecls = [reqDecl, resDecl].filter(Boolean) as ts.Declaration[];

    for (const start of startDecls) {
      const symbol =
        (start as any).symbol ||
        checker.getSymbolAtLocation((start as any).name);
      if (!symbol) continue;
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      const collected = collectTypeDeclarations(type, checker, rootDir);

      for (const decl of collected) {
        if (processed.has(decl)) continue;
        const name = (decl as any).name?.text;
        if (!name) continue;

        if (decl === reqDecl) {
          renameMap.set(decl, `Req_${meta.index}`);
        } else if (decl === resDecl) {
          renameMap.set(decl, `Res_${meta.index}`);
        } else {
          const isLocal =
            path.resolve(decl.getSourceFile().fileName) ===
            path.resolve(meta.filePath);
          if (isLocal) {
            renameMap.set(decl, `S${meta.index}_${name}`);
          } else {
            const relPath = path
              .relative(PROJECT_ROOT, decl.getSourceFile().fileName)
              .replace(/[^a-zA-Z0-9]/g, "_");
            renameMap.set(decl, `_Ext_${relPath}_${name}`);
          }
        }

        currentServiceDecls.push(decl);
        processed.add(decl);
      }
    }
    serviceDecls.push({ meta, decls: currentServiceDecls });
  }

  for (const { meta, decls } of serviceDecls) {
    if (decls.length === 0) continue;
    lines.push(
      `// ── Service ${meta.index}: ${meta.rpcMethod} ──────────────────────────────────────────`,
    );
    for (const decl of decls) {
      lines.push(printRenamedDeclaration(decl, checker, printer, renameMap));
    }
    lines.push("");
  }

  return lines.join("\n");
}
