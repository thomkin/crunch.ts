import { describe, it, expect } from "vitest";
import { service } from "./isAliveProtected";

describe("health.isAliveProtected", () => {
  it("should return default pong if no ping provided", async () => {
    const input = {};
    const context = {} as any;
    const response = await service.handler(input, context);

    expect(response.pong).toBe("pong");
    expect(response.timestamp).toBeDefined();
    expect(new Date(response.timestamp).getTime()).not.toBeNaN();
  });

  it("should return custom pong if ping provided", async () => {
    const input = { ping: "protected-ping" };
    const context = {} as any;
    const response = await service.handler(input, context);

    expect(response.pong).toBe("protected-ping");
    expect(response.timestamp).toBeDefined();
  });
});
