import { ChatGPTAuthError } from "./error.js";
import { AUTH_ISSUER, SHARING_SCOPE } from "./types.js";
import type { AuthState } from "./types.js";

export function readAuthState(value: unknown): AuthState {
  if (!record(value) || value.version !== 1 || !text(value.hostId)
    || !/^urn:uuid:[0-9a-f-]{36}$/i.test(value.hostId) || !Array.isArray(value.accounts)
    || (value.activeId !== undefined && !text(value.activeId))) invalid();
  const ids = new Set<string>();
  const registrations = new Set<string>();
  for (const account of value.accounts) {
    if (!record(account) || !text(account.id) || !text(account.label)
      || !text(account.clientId) || account.clientId === "dynamic_agent_client"
      || !["pending", "connected", "signed-out", "reauth-required"].includes(String(account.status))) invalid();
    if (ids.has(account.id) || registrations.has(account.clientId)) invalid();
    ids.add(account.id);
    registrations.add(account.clientId);
    if (account.identity !== undefined) {
      const identity = account.identity;
      if (!record(identity) || identity.issuer !== AUTH_ISSUER || !text(identity.subject)
        || (identity.email !== undefined && !text(identity.email))) invalid();
    }
    if (account.credentials !== undefined) {
      const credentials = account.credentials;
      if (!record(credentials) || !text(credentials.accessToken) || !text(credentials.refreshToken)
        || !text(credentials.idToken) || typeof credentials.expiresAt !== "number"
        || !Number.isFinite(credentials.expiresAt) || !Array.isArray(credentials.scopes)
        || !credentials.scopes.every(text) || !credentials.scopes.includes(SHARING_SCOPE)
        || account.identity === undefined || account.status !== "connected") invalid();
    }
    if (account.status === "connected" && account.credentials === undefined) invalid();
    if (account.status === "pending" && account.identity !== undefined) invalid();
  }
  if (value.activeId !== undefined && !value.accounts.some(account => account.id === value.activeId)) invalid();
  return value as unknown as AuthState;
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !/[\r\n\0]/.test(value);
}

function invalid(): never {
  throw new ChatGPTAuthError("invalid-store", "The ChatGPT credential record is invalid.");
}
