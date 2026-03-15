import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { net } from "@bunny.net/edgescript-sdk";
// import { handleRequest } from "../../build/tsc/src/handler.js";
import { signToken } from "../helpers/jwt";
import { handleRequest } from "../../src/index";
import { ServiceClient } from "../../build/generated/client";

const PORT = 8081;
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
const JWT_SECRET = "super-secret-key-123";

describe("E2E: RPC Flow with Bunny.net SDK", () => {
  let server: any;
  let client: ServiceClient | null;

  beforeAll(async () => {
    // Bunny SDK net.http.serve takes a fetch handler
    console.log(`Starting E2E server on ${BASE_URL}...`);
    client = new ServiceClient({ baseUrl: `http://${HOST}:${PORT}` });
    server = net.http.serve({ port: PORT, hostname: HOST }, handleRequest);
    // Wait a bit for the server to actually start
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  it("should handle health.isAlive public route", async () => {
    const resp = await client?.rpc.health.isAlive({ ping: "ping-value" });
    expect(resp).toBeDefined();
    expect(resp?.result?.pong).toBe("ping-value");
    expect(new Date(resp?.result?.timestamp || "").getTime()).toBeLessThan(
      Date.now(),
    );
  });

  it("should handle health.isAlive protected route", async () => {
    const resp = await client?.rpc.health.isAliveProtected({
      ping: "ping-value",
    });

    expect(resp).toBeDefined();
    expect(resp?.error).toBeDefined();
    expect(resp?.error).toBe(103);
    expect(resp?.message?.toLowerCase()).toContain("token required");
  });

  // it("should reject unauthorized requests to protected routes", async () => {
  //   // We don't have a protected route yet, but we can verify the logic
  //   // by manually adding one or just testing the error response for a non-existent method
  //   const response = await fetch(`${BASE_URL}/rpc`, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({
  //       method: "protected.test",
  //       params: {},
  //     }),
  //   });

  //   const data: any = await response.json();
  //   // It should be METHOD_NOT_FOUND (400 because we return error)
  //   expect(response.status).toBe(400);
  //   expect(data.error).toBe(102); // METHOD_NOT_FOUND
  // });

  // it("should validate token and permissions", async () => {
  //   // Since we don't have a specific protected route, let's create a temporary one in src/services
  //   // for this test, but for now we verify the JWT helper works with the router logic
  //   // as it would be bundled.

  //   const token = await signToken(
  //     {
  //       sub: "user-123",
  //       permissions: { admin: true },
  //       exp: Math.floor(Date.now() / 1000) + 3600,
  //     },
  //     JWT_SECRET,
  //   );

  //   const response = await fetch(`${BASE_URL}/rpc`, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({
  //       method: "health.isAlive", // isPublic so it ignores token, but we test payload
  //       params: { ping: "jwt-test" },
  //       token: token,
  //     }),
  //   });

  //   const data: any = await response.json();
  //   expect(response.status).toBe(200);
  //   expect(data.result.pong).toBe("jwt-test");
  // });

  // it("should reject expired tokens", async () => {
  //   const token = await signToken(
  //     {
  //       sub: "user-123",
  //       exp: Math.floor(Date.now() / 1000) - 3600,
  //     },
  //     JWT_SECRET,
  //   );

  //   const response = await fetch(`${BASE_URL}/rpc`, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({
  //       method: "health.isAlive",
  //       params: {},
  //       token: token,
  //     }),
  //   });

  //   const data: any = await response.json();
  //   expect(response.status).toBe(400);
  //   expect(data.error).toBe(103); // UNAUTHORIZED
  //   expect(data.message).toBe("Token expired");
  // });
});
