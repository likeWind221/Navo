import { describe, expect, it } from "vitest";

import { ChatGPTTokens } from "../../../src/llm/auth/chatgpt/token.js";
import { AUTH_ISSUER } from "../../../src/llm/auth/chatgpt/types.js";
import { authFixture } from "./fixture.js";

describe("ChatGPT token verification", () => {
  it("verifies identity and sends the issued client ID and PKCE", async () => {
    const fixture = await authFixture();
    try {
      const tokens = new ChatGPTTokens(fixture.fetchImpl);
      const grant = await tokens.exchange("code", "oaiapp_test", "verifier", "http://127.0.0.1:54321/auth/callback", "nonce", AbortSignal.timeout(5000));
      expect(grant.identity).toEqual({ issuer: AUTH_ISSUER, subject: "person", email: "person@example.com" });
      const body = fixture.requests.find(request => request.url.endsWith("/token"))!.body!;
      expect(Object.fromEntries(body)).toMatchObject({ client_id: "oaiapp_test", code_verifier: "verifier", resource: "https://api.openai.com/v1" });
    } finally { await fixture.close(); }
  });

  it.each(["nonce", "audience", "issuer", "expiry", "signature"])("rejects invalid %s", async kind => {
    const fixture = await authFixture();
    try {
      const valid = await fixture.sign();
      const token = kind === "signature" ? `${valid.slice(0, -12)}AAAAAAAAAAAA` : valid;
      const fetchImpl: typeof fetch = async (input, init) => String(input).endsWith("/token")
        ? Response.json({ access_token: "a", refresh_token: "r", id_token: token,
          token_type: "Bearer", expires_in: 3600, scope: "chatgpt.tokens.use.direct" })
        : fixture.fetchImpl(input, init);
      const tokens = new ChatGPTTokens(fetchImpl);
      if (kind === "issuer" || kind === "expiry") {
        const signed = await fixture.sign(kind === "issuer" ? { iss: "https://other.example" } : { exp: 1 });
        const replace: typeof fetch = async (input, init) => String(input).endsWith("/token")
          ? Response.json({ access_token: "a", refresh_token: "r", id_token: signed, token_type: "Bearer", expires_in: 3600, scope: "chatgpt.tokens.use.direct" })
          : fixture.fetchImpl(input, init);
        await expect(new ChatGPTTokens(replace).exchange("c", "oaiapp_test", "v", "http://127.0.0.1/auth/callback", "nonce", AbortSignal.timeout(5000))).rejects.toMatchObject({ code: "invalid-identity" });
      } else {
        await expect(tokens.exchange("c", kind === "audience" ? "other-client" : "oaiapp_test", "v",
          "http://127.0.0.1/auth/callback", kind === "nonce" ? "wrong-nonce" : "nonce", AbortSignal.timeout(5000)))
          .rejects.toMatchObject({ code: "invalid-identity" });
      }
    } finally { await fixture.close(); }
  });

  it("rejects identity-only permission and sanitizes token endpoint errors", async () => {
    const fixture = await authFixture();
    try {
      const tokens = new ChatGPTTokens(fixture.fetchImpl);
      fixture.setScopes("openid profile email");
      await expect(tokens.exchange("c", "oaiapp_test", "v", "http://127.0.0.1/auth/callback", "nonce", AbortSignal.timeout(5000)))
        .rejects.toMatchObject({ code: "permission-denied" });
      fixture.setFailure("invalid_grant");
      await expect(tokens.exchange("c", "oaiapp_test", "v", "http://127.0.0.1/auth/callback", "nonce", AbortSignal.timeout(5000)))
        .rejects.toMatchObject({ message: "ChatGPT authorization failed (invalid_grant)." });
    } finally { await fixture.close(); }
  });
});
