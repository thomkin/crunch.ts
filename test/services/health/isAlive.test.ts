import { describe, it, expect, vi } from "vitest";
import { service } from "./isAlive";

describe("health.isAlive", () => {
  it("should return default pong if no ping provided", async () => {
    const input = {};
    const context = {} as any;
    const response = await service.handler(input, context);

    expect(response.pong).toBe("pong");
    expect(response.timestamp).toBeDefined();
    expect(new Date(response.timestamp).getTime()).not.toBeNaN();
  });

  it("should return custom pong if ping provided", async () => {
    const input = { ping: "hello" };
    const context = {} as any;
    const response = await service.handler(input, context);

    expect(response.pong).toBe("hello");
    expect(response.timestamp).toBeDefined();
  });
});
