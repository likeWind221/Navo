import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";

import { ChatGPTAuthError } from "./error.js";
import { AUTH_ISSUER, AUTH_RESOURCE } from "./types.js";

export interface LoginAttempt {
  readonly clientId: string;
  readonly code: string;
  readonly verifier: string;
  readonly nonce: string;
  readonly redirectUri: string;
}

export interface LoginFlowOptions {
  readonly hostId: string;
  readonly clientId?: string;
  readonly idToken?: string;
  readonly signal: AbortSignal;
  readonly openBrowser: (url: string) => Promise<void>;
}

export async function authorizeChatGPT(options: LoginFlowOptions): Promise<LoginAttempt> {
  options.signal.throwIfAborted();
  const state = randomValue();
  const nonce = randomValue();
  const verifier = randomValue();
  let resolveCallback!: (value: { code: string; clientId: string }) => void;
  let rejectCallback!: (error: unknown) => void;
  const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  let settled = false;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const finishResponse = (status: number, message: string): void => {
      response.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end(message);
    };
    if (url.pathname !== "/auth/callback" || request.method !== "GET") {
      finishResponse(404, "Unknown callback.");
      return;
    }
    if (settled || url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state) {
      finishResponse(400, "Invalid authorization state.");
      return;
    }
    const denied = url.searchParams.has("error");
    const code = url.searchParams.get("code");
    const returnedId = url.searchParams.get("client_id");
    const clientId = returnedId ?? options.clientId;
    if (denied) {
      settled = true;
      finishResponse(400, "ChatGPT authorization was declined.");
      rejectCallback(new ChatGPTAuthError("access-denied", "ChatGPT authorization was declined."));
    } else if (!code || url.searchParams.getAll("code").length !== 1 || !clientId
      || clientId === "dynamic_agent_client" || /[\r\n\0]/.test(clientId)
      || url.searchParams.getAll("client_id").length > 1
      || (options.clientId !== undefined && clientId !== options.clientId)) {
      settled = true;
      finishResponse(400, "Invalid authorization callback.");
      rejectCallback(new ChatGPTAuthError("invalid-callback", "The ChatGPT callback has no valid code or matching client ID."));
    } else {
      settled = true;
      finishResponse(200, "Authorization received. Return to Navo to check verification.");
      resolveCallback({ code, clientId });
    }
  });
  const aborted = (): void => { rejectCallback(options.signal.reason); };
  options.signal.addEventListener("abort", aborted, { once: true });
  void callback.catch(() => undefined);
  try {
    await listen(server, options.signal);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No loopback callback address.");
    const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
    const url = new URL(`${AUTH_ISSUER}/api/accounts/authorize`);
    url.search = new URLSearchParams({
      client_id: options.clientId ?? "dynamic_agent_client",
      ...(options.clientId === undefined ? { agent_name_hint: "Navo" } : {}),
      ...(options.idToken === undefined ? {} : { id_token_hint: options.idToken }),
      ext_agent_host_id: options.hostId, response_type: "code", redirect_uri: redirectUri,
      resource: AUTH_RESOURCE, scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      state, nonce, code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    }).toString();
    options.signal.throwIfAborted();
    await options.openBrowser(url.toString());
    const result = await callback;
    options.signal.throwIfAborted();
    return { ...result, verifier, nonce, redirectUri };
  } finally {
    options.signal.removeEventListener("abort", aborted);
    await new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}

function randomValue(): string {
  return randomBytes(32).toString("base64url");
}

function listen(server: Server, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = (): void => { reject(signal.reason); };
    const error = (cause: Error): void => { cleanup(); reject(cause); };
    const cleanup = (): void => {
      signal.removeEventListener("abort", abort);
      server.removeListener("error", error);
    };
    signal.addEventListener("abort", abort, { once: true });
    server.once("error", error);
    server.listen(0, "127.0.0.1", () => { cleanup(); resolve(); });
  });
}
