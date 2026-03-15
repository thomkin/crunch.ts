import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Config {
  serviceDirectories?: string[];
  clientOutDir?: string;
}

export function loadConfig(): Config {
  console.log("CRUNCH_CFG", process.env.CRUNCH_CFG);
  if (process.env.CRUNCH_CFG) {
    const customPath = path.resolve(process.env.CRUNCH_CFG);
    if (fs.existsSync(customPath)) {
      try {
        return JSON.parse(fs.readFileSync(customPath, "utf-8"));
      } catch (err: any) {
        console.warn(
          `Failed to parse crunchy.json: ${err.message}. Using defaults.`,
        );
      }
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
    const symbol = t.aliasSymbol ?? t.getSymbol();
    if (!symbol) return;
    const declarations = symbol.getDeclarations() ?? [];
    for (const decl of declarations) {
      if (visited.has(decl)) continue;
      const declFile = decl.getSourceFile().fileName;
      if (!declFile.startsWith(rootDir)) continue;
      visited.add(decl);
      result.push(decl);
      const innerType = checker.getDeclaredTypeOfSymbol(symbol);
      for (const prop of innerType.getProperties()) {
        const propType = checker.getTypeOfSymbol(prop);
        enqueue(propType);
        if (propType.isUnion()) {
          for (const u of propType.types) enqueue(u);
        }
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
  ts.forEachChild(serviceTypeSf, (node) => {
    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isTypeAliasDeclaration(node)
    ) {
      if (CLIENT_VISIBLE_SERVICE_TYPES.has(node.name.text)) {
        lines.push(printDeclaration(node, printer));
      }
    }
  });
  lines.push("");

  const alreadyPrinted = new Set<ts.Declaration>();
  const sharedDecls: ts.Declaration[] = [];

  for (const meta of metas) {
    const sf = program.getSourceFile(meta.filePath);
    if (!sf) {
      console.warn(
        `[utils] Warning: Cannot find source file for ${meta.filePath}`,
      );
      continue;
    }

    // Instead of using checker.getExportsOfModule, let's look for declarations directly
    const reqDecl = sf.statements.find(
      (s) =>
        (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) &&
        s.name.text === "Request",
    ) as ts.Declaration | undefined;
    const resDecl = sf.statements.find(
      (s) =>
        (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) &&
        s.name.text === "Response",
    ) as ts.Declaration | undefined;

    lines.push(
      `// ── Service ${meta.index}: ${meta.rpcMethod} ──────────────────────────────────────────`,
    );

    const symbolsToProcess: { decl: ts.Declaration; name: string }[] = [];
    if (reqDecl) symbolsToProcess.push({ decl: reqDecl, name: "Request" });
    if (resDecl) symbolsToProcess.push({ decl: resDecl, name: "Response" });

    if (symbolsToProcess.length === 0) {
      console.warn(
        `[utils] Warning: No Request/Response found in ${meta.filePath}`,
      );
    }

    for (const { decl: startDecl, name: origName } of symbolsToProcess) {
      const symbol = checker.getSymbolAtLocation((startDecl as any).name);
      if (!symbol) continue;

      const type = checker.getDeclaredTypeOfSymbol(symbol);
      const decls = collectTypeDeclarations(type, checker, rootDir);

      for (const decl of decls) {
        if (alreadyPrinted.has(decl)) continue;
        alreadyPrinted.add(decl);

        const declFile = decl.getSourceFile().fileName;
        const isServiceOwnType =
          declFile === meta.filePath &&
          (ts.isInterfaceDeclaration(decl) ||
            ts.isTypeAliasDeclaration(decl)) &&
          ((decl as ts.InterfaceDeclaration | ts.TypeAliasDeclaration).name
            .text === "Request" ||
            (decl as ts.InterfaceDeclaration | ts.TypeAliasDeclaration).name
              .text === "Response");

        if (isServiceOwnType) {
          const currentName = (
            decl as ts.InterfaceDeclaration | ts.TypeAliasDeclaration
          ).name.text;
          const newName =
            currentName === "Request"
              ? `Req_${meta.index}`
              : `Res_${meta.index}`;
          const raw = printDeclaration(decl, printer);
          lines.push(raw.replace(new RegExp(`\\b${currentName}\\b`), newName));
        } else {
          sharedDecls.push(decl);
        }
      }
    }
    lines.push("");
  }

  if (sharedDecls.length > 0) {
    const uniqueShared = sharedDecls.filter((d) => {
      if (alreadyPrinted.has(d)) return false;
      alreadyPrinted.add(d);
      return true;
    });
    if (uniqueShared.length > 0) {
      lines.push(
        "// ── Shared sub-types referenced by the above ───────────────────────────────",
      );
      for (const decl of uniqueShared) {
        lines.push(printDeclaration(decl, printer));
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}
