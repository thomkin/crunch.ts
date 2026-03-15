import { describe, it, expect } from "vitest";
import { verifyToken, hasPermission } from "../src/auth/jwt";

// Helper to generate a valid Edge-compatible JWT for testing
async function generateTestToken(payload: any, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const headerB64 = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })).replace(
    /=/g,
    "",
  );
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, "");

  const data = encoder.encode(`${headerB64}.${payloadB64}`);
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, data);

  const signatureB64 = btoa(
    String.fromCharCode(...new Uint8Array(signatureBuffer)),
  )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

describe("JWT Auth", () => {
  const SECRET = "test-secret-key";

  it("should successfully verify a valid token", async () => {
    const payload = { sub: "user-1", permissions: { admin: true } };
    const token = await generateTestToken(payload, SECRET);

    const result = await verifyToken(token, SECRET);
    expect(result.valid).toBe(true);
    expect(result.payload?.sub).toBe("user-1");
  });

  it("should reject a token with an invalid signature", async () => {
    const payload = { sub: "user-1" };
    const token = await generateTestToken(payload, SECRET);
    const badToken = token.substring(0, token.length - 2) + "AA";

    const result = await verifyToken(badToken, SECRET);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid signature");
  });

  it("should reject an expired token", async () => {
    const payload = {
      sub: "user-1",
      exp: Math.floor(Date.now() / 1000) - 3600,
    };
    const token = await generateTestToken(payload, SECRET);

    const result = await verifyToken(token, SECRET);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Token expired");
  });

  it("should check permissions correctly", () => {
    const payload = { permissions: { read: true, write: false } };
    expect(hasPermission(payload, "read")).toBe(true);
    expect(hasPermission(payload, "write")).toBe(false);
    expect(hasPermission(payload, "admin")).toBe(false);
  });
});
