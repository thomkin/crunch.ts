// Ultra-fast zero-dependency JWT implementation using WebCrypto
// Specifically tailored for Edge runtime

// We encode our signing key. You'd normally load this from an environment variable in Edge.
const encoder = new TextEncoder();

// Function to import the raw string secret into a WebCrypto Key
async function importKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

function base64UrlDecode(str: string): string {
  // Convert Base64URL to Base64
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Pad with '='
  while (base64.length % 4) {
    base64 += "=";
  }
  return atob(base64);
}

interface JwtPayload {
  sub?: string; // userId
  exp?: number;
  permissions?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface TokenVerificationResult {
  valid: boolean;
  payload?: JwtPayload;
  error?: string;
}

export async function verifyToken(
  token: string,
  secret: string,
): Promise<TokenVerificationResult> {
  if (!token) {
    return { valid: false, error: "Token is missing" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Invalid token format" };
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Decode Payload
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64)) as JwtPayload;
  } catch (e) {
    return { valid: false, error: "Invalid payload format" };
  }

  // 2. Check Expiration
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, error: "Token expired" };
  }

  // 3. Verify Signature
  try {
    const key = await importKey(secret);

    // The data that was signed is "header.payload"
    const data = encoder.encode(`${headerB64}.${payloadB64}`);

    // Decode the signature to raw bytes
    const signatureBytes = new Uint8Array(
      atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map((c) => c.charCodeAt(0)),
    );

    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      data,
    );

    if (!isValid) {
      return { valid: false, error: "Invalid signature" };
    }

    return { valid: true, payload };
  } catch (e) {
    return { valid: false, error: "Error verifying signature" };
  }
}

export function hasPermission(
  payload: JwtPayload,
  requiredPermission: string,
): boolean {
  if (!payload.permissions) return false;
  return payload.permissions[requiredPermission] === true;
}
