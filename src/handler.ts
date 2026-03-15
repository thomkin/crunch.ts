import { handleRpcRequest } from "./router/rpc";
import { handleHttpRequest } from "./router/http";
import { RpcErrorCode } from "./types/service";

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // 1. Route /rpc to the RPC engine
  if (path === "/rpc" || path === "/rpc/") {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      const body = await request.json();
      const responsePayload = await handleRpcRequest(body, request.headers);
      const status = typeof responsePayload.error === "number" ? 400 : 200;

      return new Response(JSON.stringify(responsePayload), {
        status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (err: any) {
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
  return handleHttpRequest(request);
}
