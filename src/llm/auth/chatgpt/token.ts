import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

import { ChatGPTAuthError } from "./error.js";
import { record, text } from "./schema.js";
import { AUTH_ISSUER, AUTH_RESOURCE, SHARING_SCOPE } from "./types.js";
import type { AccountRecord, Credentials, Identity, TokenGrant } from "./types.js";

interface Discovery {
  jwks_uri: string;
  revocation_endpoint: string;
}

export class ChatGPTTokens {
  private metadata: Promise<Discovery> | undefined;
  private keys: ReturnType<typeof createRemoteJWKSet> | undefined;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async exchange(code: string, clientId: string, verifier: string, redirectUri: string, nonce: string, signal: AbortSignal): Promise<TokenGrant> {
    const token = await this.request(new URLSearchParams({
      grant_type: "authorization_code", client_id: clientId, code,
      code_verifier: verifier, redirect_uri: redirectUri, resource: AUTH_RESOURCE,
    }), signal);
    const idToken = required(token.id_token);
    const identity = await this.identity(idToken, clientId, signal, nonce);
    return { identity, credentials: credentials(token, idToken) };
  }

  async refresh(account: AccountRecord, signal: AbortSignal): Promise<Credentials> {
    const previous = account.credentials;
    if (!previous || !account.identity) throw new ChatGPTAuthError("login-required", "Sign in to ChatGPT first.");
    const token = await this.request(new URLSearchParams({
      grant_type: "refresh_token", client_id: account.clientId,
      refresh_token: previous.refreshToken, resource: AUTH_RESOURCE,
    }), signal);
    const next = credentials(token, previous.idToken, previous);
    if (token.id_token !== undefined) {
      const identity = await this.identity(next.idToken, account.clientId, signal);
      if (identity.subject !== account.identity.subject || identity.issuer !== account.identity.issuer) {
        throw new ChatGPTAuthError("identity-mismatch", "The refreshed ChatGPT identity does not match this registration.");
      }
    }
    return next;
  }

  async revoke(account: AccountRecord, signal: AbortSignal): Promise<boolean> {
    if (!account.credentials) return false;
    const metadata = await this.discovery(signal);
    let response: Response;
    try {
      response = await this.fetchImpl(metadata.revocation_endpoint, {
        method: "POST", redirect: "error", signal,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: account.credentials.refreshToken,
          token_type_hint: "refresh_token", client_id: account.clientId }),
      });
    } catch {
      signal.throwIfAborted();
      throw new ChatGPTAuthError("revocation-unconfirmed", "Remote ChatGPT revocation was not confirmed. Disconnect Navo in ChatGPT Settings.");
    }
    await response.body?.cancel();
    if (response.status !== 200) throw new ChatGPTAuthError("revocation-unconfirmed", "Remote ChatGPT revocation was not confirmed. Disconnect Navo in ChatGPT Settings.", response.status);
    return true;
  }

  private async request(body: URLSearchParams, signal: AbortSignal): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${AUTH_ISSUER}/api/accounts/oauth/token`, {
        method: "POST", redirect: "error", signal, body,
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      });
    } catch {
      signal.throwIfAborted();
      throw new ChatGPTAuthError("auth-network", "The ChatGPT token endpoint could not be reached.");
    }
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = record(value) && ["invalid_grant", "invalid_client", "access_denied"].includes(String(value.error))
        ? String(value.error) : "token-request-failed";
      throw new ChatGPTAuthError(code, `ChatGPT authorization failed (${code}).`, response.status);
    }
    if (!record(value)) throw new ChatGPTAuthError("invalid-token", "The ChatGPT token response is invalid.");
    return value;
  }

  private async discovery(signal: AbortSignal): Promise<Discovery> {
    this.metadata ??= this.loadDiscovery(signal).catch(error => {
      this.metadata = undefined;
      throw error;
    });
    return this.metadata;
  }

  private async loadDiscovery(signal: AbortSignal): Promise<Discovery> {
    const response = await this.fetchImpl(`${AUTH_ISSUER}/.well-known/openid-configuration`, { signal, redirect: "error" });
    const value: unknown = await response.json();
    if (!response.ok || !record(value) || value.issuer !== AUTH_ISSUER
      || !trustedEndpoint(value.jwks_uri) || !trustedEndpoint(value.revocation_endpoint)) {
      throw new ChatGPTAuthError("invalid-discovery", "OpenAI authentication discovery is invalid.");
    }
    return { jwks_uri: value.jwks_uri, revocation_endpoint: value.revocation_endpoint };
  }

  private async identity(token: string, clientId: string, signal: AbortSignal, nonce?: string): Promise<Identity> {
    const metadata = await this.discovery(signal);
    this.keys ??= createRemoteJWKSet(new URL(metadata.jwks_uri), { [customFetch]: this.fetchImpl });
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: AUTH_ISSUER, audience: clientId, requiredClaims: ["exp", "iat", "sub"],
        algorithms: ["RS256", "ES256"],
      });
      signal.throwIfAborted();
      if (!text(payload.sub) || (nonce !== undefined && payload.nonce !== nonce)
        || (payload.email !== undefined && !text(payload.email))) throw new Error();
      return { issuer: AUTH_ISSUER, subject: payload.sub,
        ...(payload.email === undefined ? {} : { email: payload.email as string }) };
    } catch {
      signal.throwIfAborted();
      throw new ChatGPTAuthError("invalid-identity", "The ChatGPT ID token failed identity verification.");
    }
  }
}

function credentials(token: Record<string, unknown>, idToken: string, previous?: Credentials): Credentials {
  const accessToken = required(token.access_token);
  const refreshToken = token.refresh_token === undefined && previous ? previous.refreshToken : required(token.refresh_token);
  const scopes = token.scope === undefined && previous ? previous.scopes : required(token.scope).split(/\s+/);
  if (!scopes.includes(SHARING_SCOPE)) throw new ChatGPTAuthError("permission-denied", "ChatGPT plan usage permission was not granted.");
  if (typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0
    || typeof token.token_type !== "string" || token.token_type.toLowerCase() !== "bearer") {
    throw new ChatGPTAuthError("invalid-token", "The ChatGPT token response has invalid expiry or token type.");
  }
  return { accessToken, refreshToken, idToken: token.id_token === undefined ? idToken : required(token.id_token),
    scopes, expiresAt: Date.now() + token.expires_in * 1000 };
}

function required(value: unknown): string {
  if (!text(value)) throw new ChatGPTAuthError("invalid-token", "The ChatGPT token response is missing a required field.");
  return value;
}

function trustedEndpoint(value: unknown): value is string {
  if (!text(value)) return false;
  try {
    const url = new URL(value);
    return url.origin === AUTH_ISSUER && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}
