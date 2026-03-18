import { handleRpcRequest } from "./router/rpc";
import { handleHttpRequest } from "./router/http";
import { RpcErrorCode } from "./types/service";

interface options {
  enableHttp?: boolean;
  rpcOnly?: boolean;
}

export async function handleRequest(
  request: Request,
  options: options,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // 1. Route /rpc to the RPC engine
  if (options.rpcOnly || path === "/rpc" || path === "/rpc/") {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      const body = await request.json();
      const responsePayload = await handleRpcRequest(body, request.headers);
      // Determine status code: 200 for success, 400 for client errors, 500 for internal errors
      let status = 200;
      if (responsePayload.error) {
        switch (responsePayload.error) {
          case RpcErrorCode.InvalidRequest:
          case RpcErrorCode.InvalidMethod:
          case RpcErrorCode.MethodNotFound:
          case RpcErrorCode.ValidationError:
            status = 400;
            break;
          case RpcErrorCode.Unauthorized:
          case RpcErrorCode.Forbidden:
            status = 401; // Or 403 depending on the specific error
            break;
          case RpcErrorCode.InternalError:
          default:
            status = 500;
            break;
        }
      }

      return new Response(JSON.stringify(responsePayload), {
        status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (err: any) {
      // This catch block handles errors during request.json() parsing
      console.error("Failed to parse JSON body:", err);
      return new Response(
        JSON.stringify({
          error: RpcErrorCode.InvalidRequest,
          message: "Request body must be valid JSON",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }
  }

  // 2. Generic HTTP Routing
  if (options.enableHttp) {
    return handleHttpRequest(request);
  }

  //Now route found
  return new Response("Not Found", { status: 404 });
}
