import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exportJWK, generateKeyPair, SignJWT } from "jose";

import { ChatGPTAuth } from "../../../src/llm/auth/chatgpt.js";
import { ChatGPTStore } from "../../../src/llm/auth/chatgpt/store.js";
import { AUTH_ISSUER, SHARING_SCOPE } from "../../../src/llm/auth/chatgpt/types.js";

export async function authFixture() {
  const home = await mkdtemp(join(tmpdir(), "navo-auth-"));
  const keys = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(keys.publicKey), kid: "auth-key", alg: "RS256" };
  const requests: { url: string; body?: URLSearchParams }[] = [];
  let nonce = "nonce";
  let clientId = "oaiapp_test";
  let grantFailure: string | undefined;
  let scopes = `openid profile email offline_access resource.invoke ${SHARING_SCOPE}`;
  let tokenLifetime = 3600;
  let revoked = false;
  let refreshCount = 0;
  let refreshGate: Promise<void> | undefined;
  let exchangeGate: Promise<void> | undefined;
  let modelGate: Promise<void> | undefined;
  let revokeStatus = 200;
  let refreshStarted!: () => void;
  const startedRefresh = new Promise<void>(resolve => { refreshStarted = resolve; });
  let modelStarted!: () => void;
  const startedModel = new Promise<void>(resolve => { modelStarted = resolve; });
  let exchangeStarted!: () => void;
  const startedExchange = new Promise<void>(resolve => { exchangeStarted = resolve; });
  let catalog: unknown = { models: [
    { slug: "model-b", display_name: "Model B", visibility: "list" },
    { slug: "hidden", visibility: "hidden" },
    { slug: "model-a", display_name: "Model A", visibility: "list" },
  ] };
  const sign = async (claims: Record<string, unknown> = {}) => new SignJWT({
    sub: "person", email: "person@example.com", nonce, iss: AUTH_ISSUER, aud: clientId,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...claims,
  }).setProtectedHeader({ alg: "RS256", kid: "auth-key" }).sign(keys.privateKey);
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body instanceof URLSearchParams ? init.body : undefined;
    requests.push({ url, ...(body === undefined ? {} : { body }) });
    if (url.endsWith("openid-configuration")) return Response.json({
      issuer: AUTH_ISSUER, jwks_uri: `${AUTH_ISSUER}/keys`, revocation_endpoint: `${AUTH_ISSUER}/revoke`,
    });
    if (url.endsWith("/keys")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/revoke")) {
      revoked = revokeStatus === 200;
      return new Response(null, { status: revokeStatus });
    }
    if (url.endsWith("/models")) {
      modelStarted();
      await modelGate;
      init?.signal?.throwIfAborted();
      return Response.json(catalog);
    }
    if (url.endsWith("/token")) {
      if (body?.get("grant_type") === "authorization_code") {
        exchangeStarted();
        await exchangeGate;
      }
      if (grantFailure) return Response.json({ error: grantFailure, secret: "never-display" }, { status: 400 });
      if (body?.get("grant_type") === "refresh_token") {
        refreshCount++;
        refreshStarted();
        await refreshGate;
        init?.signal?.throwIfAborted();
      }
      return Response.json({ access_token: `access-${refreshCount}`, refresh_token: `refresh-${refreshCount}`,
        id_token: await sign(), token_type: "Bearer", expires_in: tokenLifetime, scope: scopes });
    }
    throw new Error("Unexpected fixture endpoint.");
  };
  const openBrowser = async (raw: string) => {
    const url = new URL(raw);
    nonce = url.searchParams.get("nonce")!;
    const supplied = url.searchParams.get("client_id");
    if (supplied !== "dynamic_agent_client") clientId = supplied!;
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({ code: "valid-code", state: url.searchParams.get("state")!, client_id: clientId }).toString();
    const response = await fetch(callback);
    if (response.status !== 200) throw new Error("Fixture callback rejected.");
  };
  const make = () => new ChatGPTAuth({ home, fetch: fetchImpl, openBrowser });
  const store = new ChatGPTStore(home);
  const expire = async () => store.transaction(async state => {
    state.accounts[0]!.credentials!.expiresAt = Date.now() - 1000;
  });
  return {
    home, store, make, fetchImpl, openBrowser, sign, requests, expire,
    startedRefresh, startedModel, startedExchange,
    close: async () => rm(home, { recursive: true, force: true }),
    setFailure: (value?: string) => { grantFailure = value; },
    setScopes: (value: string) => { scopes = value; },
    setLifetime: (value: number) => { tokenLifetime = value; },
    setClient: () => { clientId = `oaiapp_${randomUUID()}`; },
    setRefreshGate: (value: Promise<void>) => { refreshGate = value; },
    setExchangeGate: (value: Promise<void>) => { exchangeGate = value; },
    setModelGate: (value: Promise<void>) => { modelGate = value; },
    setRevokeStatus: (value: number) => { revokeStatus = value; },
    setCatalog: (value: unknown) => { catalog = value; },
    get refreshCount() { return refreshCount; },
    get revoked() { return revoked; },
  };
}
