import { JwtPayload } from "../types/service";

export async function signToken(
  payload: JwtPayload,
  secret: string,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = await crypto.subtle.sign("HMAC", key, data);
  const signatureB64 = Buffer.from(signature).toString("base64url");

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}
