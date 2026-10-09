import { sha256Hex } from "@/services/ledger/sha256";

// API-key authentication for the REST API.
//
//   SILKSOL_API_KEYS="erp-forwarder:<key>,insurer-x:<key>"   (client name : secret, comma-separated)
//   SILKSOL_API_AUTH=off                                       (local demos only — disables keys)
//
// Clients send `Authorization: Bearer <key>` or `X-API-Key: <key>`. Keys are compared by SHA-256
// digest in constant time, and only the client name reaches the access log. An SSO / OIDC
// gateway (Keycloak, the customer's IdP) can sit in front of the API in corporate deployments.

export type ApiClient = { name: string };

export type AuthConfig = {
  disabled: boolean;
  /** SHA-256 hex digest of each key → client. */
  keys: Map<string, ApiClient>;
};

export function authConfigFromEnv(env: Record<string, string | undefined>): AuthConfig {
  const keys = new Map<string, ApiClient>();
  for (const entry of (env["SILKSOL_API_KEYS"] ?? "").split(",")) {
    const sep = entry.indexOf(":");
    if (sep < 1) continue;
    const name = entry.slice(0, sep).trim();
    const key = entry.slice(sep + 1).trim();
    if (name && key.length >= 16) keys.set(sha256Hex(key), { name });
  }
  return { disabled: env["SILKSOL_API_AUTH"] === "off", keys };
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function presentedKey(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-api-key");
}

/** The authenticated client, or null. */
export function authenticate(request: Request, config: AuthConfig): ApiClient | null {
  if (config.disabled) return { name: "anonymous (auth off)" };
  const key = presentedKey(request);
  if (!key) return null;
  const digest = sha256Hex(key);
  let match: ApiClient | null = null;
  for (const [stored, client] of config.keys) if (safeEqual(stored, digest)) match = client;
  return match;
}
