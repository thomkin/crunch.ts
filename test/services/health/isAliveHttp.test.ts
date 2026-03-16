import { describe, it, expect } from "vitest";
import { service } from "./isAliveHttp";

describe("health.isAliveHttp", () => {
  it("should return status alive and a timestamp", async () => {
    const input = {};
    const response = await service.handler(input, {} as any);

    expect(response.status).toBe("alive");
    expect(response.timestamp).toBeTypeOf("number");
    expect(response.timestamp).toBeLessThanOrEqual(Date.now());
  });
});
