//@ts-nocheck
import { ServiceRegistry } from "../../build/generated/registry";
import {
  RpcContext,
  RpcResponse,
  RpcErrorCode,
  HttpMethod,
} from "../types/service";
import { verifyToken, hasPermission } from "../auth/jwt";

const JWT_SECRET = process.env.JWT_SECRET;

export async function handleHttpRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method as HttpMethod;

  // 1. Find the matching service
  const match = findService(path, method);
  if (!match) {
    return new Response(
      JSON.stringify({
        error: RpcErrorCode.MethodNotFound,
        message: `Route ${method} ${path} not found`,
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const { service, params } = match;
  const { definition, validate } = service;

  // 2. Authenticate and Authorize
  const ctx: RpcContext = {
    permissions: {},
    params,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: request.headers,
  };

  if (!definition.isPublic) {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({
          error: RpcErrorCode.Unauthorized,
          message: "Authentication token required in Authorization header",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.substring(7);
    if (!JWT_SECRET) {
      console.error("JWT_SECRET is not set.");
      return new Response(
        JSON.stringify({
          error: RpcErrorCode.InternalError,
          message: "JWT Secret not configured",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const verifyResult = await verifyToken(token, JWT_SECRET);
    if (!verifyResult.valid || !verifyResult.payload) {
      return new Response(
        JSON.stringify({
          error: RpcErrorCode.Unauthorized,
          message: verifyResult.error || "Invalid Token",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    ctx.userId = verifyResult.payload.sub;
    ctx.permissions = verifyResult.payload.permissions || {};

    if (
      definition.requiredPermission &&
      !hasPermission(verifyResult.payload, definition.requiredPermission)
    ) {
      return new Response(
        JSON.stringify({
          error: RpcErrorCode.Forbidden,
          message: `Missing required permission: ${definition.requiredPermission}`,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  // 3. Prepare Input (merge params and body if applicable)
  let input: any = { ...ctx.params, ...ctx.query };
  if (
    method !== "GET" &&
    method !== "HEAD" &&
    request.headers.get("Content-Type")?.includes("application/json")
  ) {
    try {
      const body = await request.json();
      input = { ...input, ...body };
    } catch (e) {
      // Body is optional or might be empty, log error if it's not expected
      if (request.headers.get("Content-Length") !== "0") {
        console.warn(`Failed to parse JSON body for ${method} ${path}:`, e);
      }
    }
  }

  // 4. Validate Input
  let validatedInput;
  try {
    validatedInput = validate(input);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: RpcErrorCode.ValidationError,
        message: "Invalid parameters",
        result: err.paths || err.message,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // 5. Execute Handler
  try {
    const result = await definition.handler(validatedInput, ctx);
    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err: any) {
    console.error(`HTTP Service Error for ${method} ${path}:`, err);
    return new Response(
      JSON.stringify({
        error: RpcErrorCode.InternalError,
        message: "An internal server error occurred",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

function findService(path: string, method: HttpMethod) {
  // Normalize path
  const normalizedPath =
    path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  const pathParts = normalizedPath.split("/").filter(Boolean);

  for (const key in ServiceRegistry) {
    const service = ServiceRegistry[key];
    const def = service.definition;

    if (!def.path || !def.httpMethod || def.httpMethod !== method) continue;

    const patternParts = def.path.split("/").filter(Boolean);
    const params: Record<string, string> = {};
    let isMatch = true;

    // Handle wildcard path matching
    if (def.path.endsWith("*")) {
      const wildcardPath = def.path.slice(0, -1); // Remove trailing '*'
      const wildcardPathParts = wildcardPath.split("/").filter(Boolean);
      if (pathParts.length < wildcardPathParts.length) {
        continue; // Not enough parts to match the base path
      }
      // Check the fixed parts of the path
      for (let i = 0; i < wildcardPathParts.length; i++) {
        const patternPart = wildcardPathParts[i];
        const pathPart = pathParts[i];
        if (patternPart.startsWith(":")) {
          const paramName = patternPart.slice(1);
          params[paramName] = pathPart;
        } else if (patternPart !== pathPart) {
          isMatch = false;
          break;
        }
      }
      if (isMatch) {
        // Capture the rest of the path as a single string for the wildcard parameter
        const wildcardParamName = "wildcard"; // Default name, could be configurable
        params[wildcardParamName] = pathParts.slice(wildcardPathParts.length).join("/");
      }
    } else {
      // Standard path matching
      if (patternParts.length !== pathParts.length) {
        continue;
      }
      for (let i = 0; i < patternParts.length; i++) {
        const patternPart = patternParts[i];
        const pathPart = pathParts[i];

        if (patternPart.startsWith(":")) {
          const paramName = patternPart.slice(1);
          params[paramName] = pathPart;
        } else if (patternPart !== pathPart) {
          isMatch = false;
          break;
        }
      }
    }

    if (isMatch) {
      return { service, params };
    }
  }

  return null;
}
