import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { net } from "@bunny.net/edgescript-sdk";
import { handleRequest } from "../crunch.ts";
import { init, ServiceClient } from "../client/client";
import { signToken } from "../helpers/jwt";
import { RpcErrorCode } from "../crunch.ts/types.ts";

const PORT = 3001;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key-123";

describe("RPC End-to-End Tests", () => {
  let client: ServiceClient;
  let server: any;

  beforeAll(async () => {
    // Start local server using @bunny.net/sdk
    server = net.http.serve(
      { hostname: "127.0.0.1", port: PORT },
      async (req: Request) => {
        return handleRequest(req);
      },
    );

    client = init({ baseUrl: BASE_URL });
  });

  afterAll(() => {
    // The SDK doesn't seem to provide a clear way to stop the server in its types,
    // but @hono/node-server's serve returns a server object with .close()
    if (server && typeof server.close === "function") {
      server.close();
    }
  });

  it("should access public route (health.isAlive) without token", async () => {
    const res = await client.rpc.health.isAlive({ ping: "hello" });
    expect(res.error).toBeUndefined();
    expect(res.result?.pong).toBe("hello");
    expect(res.result?.timestamp).toBeDefined();
  });

  it("should fail to access private route without token", async () => {
    const res = await client.rpc.health.isAliveProtected({ ping: "secret" });
    expect(res.error).toBe(RpcErrorCode.Unauthorized);
    expect(res.message).toContain("Authentication token required");
  });

  it("should fail with invalid signature", async () => {
    // Generate a valid token with a different secret
    const invalidToken = await signToken({ sub: "user-123" }, "wrong-secret");
    const localClient = init({ baseUrl: BASE_URL, token: invalidToken });
    const res = await localClient.rpc.health.isAliveProtected({
      ping: "secret",
    });

    expect(res.error).toBe(RpcErrorCode.Unauthorized);
    expect(res.message).toBe("Invalid signature");
  });

  it("should access isAliveAdmin with correct permissions", async () => {
    const token = await signToken(
      { sub: "user-123", permissions: { admin: true } },
      JWT_SECRET,
    );
    const authClient = init({ baseUrl: BASE_URL, token });

    const res = await authClient.rpc.health.isAliveAdmin({
      ping: "admin-ping",
    });
    expect(res.error).toBeUndefined();
    expect(res.result?.pong).toBe("admin-ping");
  });

  it("should fail to access isAliveAdmin with wrong permissions", async () => {
    const token = await signToken(
      { sub: "user-123", permissions: { viewer: true } },
      JWT_SECRET,
    );
    const authClient = init({ baseUrl: BASE_URL, token });

    const res = await authClient.rpc.health.isAliveAdmin({
      ping: "admin-ping",
    });
    expect(res.error).toBe(RpcErrorCode.Forbidden);
    expect(res.message).toContain("Missing required permission");
  });

  it("should fail data validation for isAlive", async () => {
    // We bypass the type system to test runtime validation
    const res = await client.rpc.health.isAlive({ ping: 123 as any });
    expect(res.error).toBe(RpcErrorCode.ValidationError);
    expect(res.message).toBe("Invalid request parameters");
  });

  it("do not have the parameters defined at all", async () => {
    // We bypass the type system to test runtime validation
    const res = await client.rpc.health.isAlive({} as any);
    expect(res.error).toBe(RpcErrorCode.ValidationError);
    expect(res.message).toBe("Invalid request parameters");
  });
});
