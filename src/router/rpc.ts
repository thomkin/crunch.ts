//@ts-nocheck  its ignore because this file is created dynamcially and does not exist
import { ServiceRegistry } from "../../registry.ts";
import {
  RpcRequest,
  RpcResponse,
  RpcContext,
  RpcErrorCode,
} from "../types/service";
import { verifyToken, hasPermission } from "../auth/jwt";
import { getEnv } from "../utils/env";

// Secret key for JWT verification. Replace with your actual edge environment variable strategy
const JWT_SECRET = getEnv("JWT_SECRET");

export async function handleRpcRequest(
  requestBody: unknown,
  headers: Headers,
): Promise<RpcResponse> {
  try {
    //0. check if JWT secret is set
    if (!JWT_SECRET) {
      return {
        error: RpcErrorCode.InternalError,
        message: "internal script variables not set",
      };
    }

    // 1. Basic validation of the request format
    if (!requestBody || typeof requestBody !== "object") {
      return {
        error: RpcErrorCode.InvalidRequest,
        message: "Request must be a JSON object",
      };
    }

    const req = requestBody as RpcRequest;

    if (typeof req.method !== "string") {
      return {
        error: RpcErrorCode.InvalidMethod,
        message: 'Missing or invalid "method" property',
      };
    }

    // 2. Find the requested service
    const serviceEntry = ServiceRegistry[req.method];
    if (!serviceEntry) {
      return {
        error: RpcErrorCode.MethodNotFound,
        message: `Method '${req.method}' not found`,
      };
    }

    const { definition, validate } = serviceEntry;

    // 3. Authenticate and Authorize
    const ctx: RpcContext = {
      permissions: {},
      params: {},
      query: {},
      headers,
    };

    if (!definition.isPublic || req.token) {
      if (!req.token && !definition.isPublic) {
        return {
          error: RpcErrorCode.Unauthorized,
          message: "Authentication token required",
        };
      }

      if (req.token) {
        const verifyResult = await verifyToken(req.token, JWT_SECRET);

        if (!verifyResult.valid || !verifyResult.payload) {
          return {
            error: RpcErrorCode.Unauthorized,
            message: verifyResult.error || "Invalid Token",
          };
        }

        // Populate context
        ctx.userId = verifyResult.payload.sub;
        ctx.permissions = verifyResult.payload.permissions || {};

        // Check specific permission if required
        if (definition.requiredPermission) {
          if (
            !hasPermission(verifyResult.payload, definition.requiredPermission)
          ) {
            return {
              error: RpcErrorCode.Forbidden,
              message: `Missing required permission: ${definition.requiredPermission}`,
            };
          }
        }
      }
    }

    // 4. Validate Input using generated Typia schema
    let validatedParams: unknown;
    try {
      console.log("Going to validate the data ", req.params);
      validatedParams = validate(req.params);
    } catch (err: any) {
      console.log("Thmas --- eroor ", err);
      return {
        error: RpcErrorCode.ValidationError,
        message: "Invalid request parameters",
        result: err.paths || err.message, // Provide typia validation errors
      };
    }

    // 5. Execute handler
    const handlerResult = await definition.handler(validatedParams, ctx);

    // 6. Return standard success response
    return {
      result: handlerResult,
    };
  } catch (err: any) {
    console.error(`Error executing RPC method:`, err);
    return {
      error: RpcErrorCode.InternalError,
      message: "An internal server error occurred",
    };
  }
}
