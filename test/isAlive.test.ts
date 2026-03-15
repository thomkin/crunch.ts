import { describe, it, expect, vi } from "vitest";
import { handleRpcRequest } from "../src/router/rpc";

// Mock the generated registry since vitest runs without the pre-build step
vi.mock("@generated/registry", async () => {
  const { service } = await import("./services/health/isAlive");
  return {
    ServiceRegistry: {
      "system.isAlive": {
        definition: service,
        validate: (input: unknown) => input, // Mock validation for simple tests
      },
    },
  };
});

describe("RPC Router - isAlive", () => {
  it("should process a valid public request without a token", async () => {
    const response = await handleRpcRequest(
      {
        method: "system.isAlive",
        params: { ping: "hello" },
      },
      new Headers(),
    );

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();
    expect((response.result as any).pong).toBe("hello");
    expect((response.result as any).timestamp).toBeDefined();
  });

  it("should default to pong if no ping is provided", async () => {
    const response = await handleRpcRequest(
      {
        method: "system.isAlive",
        params: {},
      },
      new Headers(),
    );

    expect(response.error).toBeUndefined();
    expect((response.result as any).pong).toBe("pong");
  });

  it("should return error for invalid method", async () => {
    const response = await handleRpcRequest(
      {
        method: "unknown.method",
        params: {},
      },
      new Headers(),
    );

    expect(response.error).toBe(102); // METHOD_NOT_FOUND
  });
});
