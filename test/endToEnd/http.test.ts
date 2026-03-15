import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { net } from "@bunny.net/edgescript-sdk";
import { handleRequest } from "../../build/tsc/src/handler.js";
import { init } from "../../build/generated/client";

const PORT = 8082;
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;

describe("E2E: HTTP Routing & Client Library", () => {
  let server: any;

  beforeAll(async () => {
    server = net.http.serve({ port: PORT, hostname: HOST }, handleRequest);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  it("should work using the generated client", async () => {
    const client = init({ baseUrl: BASE_URL });

    // Test RPC via client
    const aliveRes = await client.rpc.health.isAlive({ ping: "client-test" });
    expect(aliveRes.result?.pong).toBe("client-test");

    // Test Health via client
    const healthRes = await client.crud.health.get({});
    expect(healthRes.result?.status).toBe("alive");
  });

  it("should return 404 for unknown routes", async () => {
    const response = await fetch(`${BASE_URL}/unknown/route`, {
      method: "GET",
    });

    expect(response.status).toBe(404);
  });
});
