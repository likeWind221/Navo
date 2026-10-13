import { describe, expect, it } from "vitest";

import { authorizeChatGPT } from "../../../src/llm/auth/chatgpt/flow.js";

describe("ChatGPT loopback authorization", () => {
  it("binds state, nonce, PKCE and the exact callback; rejects stray callbacks", async () => {
    let authorization!: URL;
    const attempt = await authorizeChatGPT({ hostId: "urn:uuid:host", signal: AbortSignal.timeout(5000),
      openBrowser: async raw => {
        authorization = new URL(raw);
        const callback = new URL(authorization.searchParams.get("redirect_uri")!);
        expect(callback.hostname).toBe("127.0.0.1");
        callback.search = new URLSearchParams({ code: "code", client_id: "oaiapp_new", state: "wrong" }).toString();
        expect((await fetch(callback)).status).toBe(400);
        callback.searchParams.set("state", authorization.searchParams.get("state")!);
        expect((await fetch(callback)).status).toBe(200);
      },
    });
    expect(attempt.clientId).toBe("oaiapp_new");
    expect(attempt.redirectUri).toBe(authorization.searchParams.get("redirect_uri"));
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(attempt.verifier).digest("base64url")).toBe(authorization.searchParams.get("code_challenge"));
    expect(attempt.nonce).toBe(authorization.searchParams.get("nonce"));
    await expect(fetch(attempt.redirectUri)).rejects.toThrow();
  });

  it("reuses the issued ID and rejects a replacement ID", async () => {
    await expect(authorizeChatGPT({ hostId: "urn:uuid:host", clientId: "oaiapp_saved", signal: AbortSignal.timeout(5000),
      openBrowser: async raw => {
        const authorization = new URL(raw);
        expect(authorization.searchParams.get("client_id")).toBe("oaiapp_saved");
        expect(authorization.searchParams.has("agent_name_hint")).toBe(false);
        const callback = new URL(authorization.searchParams.get("redirect_uri")!);
        callback.search = new URLSearchParams({ state: authorization.searchParams.get("state")!, code: "c", client_id: "different" }).toString();
        await fetch(callback);
      },
    })).rejects.toMatchObject({ code: "invalid-callback" });
  });

  it("handles declined consent and cancellation while closing the listener", async () => {
    await expect(authorizeChatGPT({ hostId: "urn:uuid:host", signal: AbortSignal.timeout(5000), openBrowser: async raw => {
      const authorization = new URL(raw);
      const callback = new URL(authorization.searchParams.get("redirect_uri")!);
      callback.search = new URLSearchParams({ state: authorization.searchParams.get("state")!, error: "access_denied" }).toString();
      await fetch(callback);
    } })).rejects.toMatchObject({ code: "access-denied" });
    const controller = new AbortController();
    let callback = "";
    await expect(authorizeChatGPT({ hostId: "urn:uuid:host", signal: controller.signal, openBrowser: async raw => {
      callback = new URL(raw).searchParams.get("redirect_uri")!;
      controller.abort(new Error("cancelled"));
    } })).rejects.toThrow("cancelled");
    await expect(fetch(callback)).rejects.toThrow();
  });
});
