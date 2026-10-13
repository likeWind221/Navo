import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { authFixture } from "./fixture.js";

vi.mock("../../../src/llm/auth/chatgpt/permissions.js", async original => {
  const actual = await original<typeof import("../../../src/llm/auth/chatgpt/permissions.js")>();
  return { ...actual, checkPermissions: vi.fn(async () => undefined) };
});

const execute = promisify(execFile);

describe("ChatGPT credential sessions", () => {
  it("restores protected credentials after reconstruction, queries ordered account models and signs out", async () => {
    const fixture = await authFixture();
    try {
      const account = await fixture.make().login();
      expect(account.sharing).toBe(true);
      expect(JSON.stringify(account)).not.toContain("access-");
      const rebuilt = fixture.make();
      expect(await rebuilt.models()).toEqual([
        { slug: "model-b", displayName: "Model B" }, { slug: "model-a", displayName: "Model A" },
      ]);
      const before = JSON.parse(await readFile(join(fixture.home, "auth", "chatgpt.json"), "utf8"));
      await rebuilt.logout();
      expect(fixture.revoked).toBe(true);
      const after = JSON.parse(await readFile(join(fixture.home, "auth", "chatgpt.json"), "utf8"));
      expect(after.hostId).toBe(before.hostId);
      expect(after.accounts[0].clientId).toBe(before.accounts[0].clientId);
      expect(after.accounts[0].credentials).toBeUndefined();
      await expect(rebuilt.models()).rejects.toMatchObject({ code: "login-required" });
      await rebuilt.login({ accountId: account.id });
      expect((await rebuilt.accounts()).accounts).toHaveLength(1);
    } finally { await fixture.close(); }
  }, 30_000);

  it("retains an incomplete issued registration without activating it", async () => {
    const fixture = await authFixture();
    try {
      fixture.setFailure("invalid_grant");
      const auth = fixture.make();
      await expect(auth.login()).rejects.toMatchObject({ code: "invalid_grant" });
      const pending = await auth.accounts();
      expect(pending.activeId).toBeUndefined();
      expect(pending.accounts[0]?.status).toBe("pending");
      fixture.setFailure();
      await auth.login({ accountId: pending.accounts[0]!.id });
      expect((await auth.accounts()).accounts).toHaveLength(1);
    } finally { await fixture.close(); }
  }, 20_000);

  it("keeps separate registrations with the same email", async () => {
    const fixture = await authFixture();
    try {
      const auth = fixture.make();
      await auth.login();
      fixture.setClient();
      await auth.login({ newAccount: true });
      const { accounts } = await auth.accounts();
      expect(accounts).toHaveLength(2);
      expect(accounts[0]?.email).toBe(accounts[1]?.email);
      expect(accounts[0]?.id).not.toBe(accounts[1]?.id);
    } finally { await fixture.close(); }
  }, 20_000);

  it("does not activate a pending login after that registration signs out", async () => {
    const fixture = await authFixture();
    try {
      const auth = fixture.make();
      let resume!: () => void;
      fixture.setExchangeGate(new Promise<void>(resolve => { resume = resolve; }));
      const login = auth.login();
      const rejected = expect(login).rejects.toMatchObject({ code: "account-changed" });
      await fixture.startedExchange;
      const pending = (await auth.accounts()).accounts[0]!;
      await auth.logout(pending.id);
      resume();
      await rejected;
      expect((await auth.accounts()).accounts[0]?.status).toBe("signed-out");
    } finally { await fixture.close(); }
  }, 20_000);

  it("does not overwrite a connected account when new consent lacks plan permission", async () => {
    const fixture = await authFixture();
    try {
      const auth = fixture.make();
      const active = await auth.login();
      fixture.setClient();
      fixture.setScopes("openid email profile");
      await expect(auth.login({ newAccount: true })).rejects.toMatchObject({ code: "permission-denied" });
      const state = await auth.accounts();
      expect(state.activeId).toBe(active.id);
      expect(state.accounts[1]?.status).toBe("pending");
    } finally { await fixture.close(); }
  }, 20_000);

  it("serializes rotating refresh across two processes", async () => {
    const fixture = await authFixture();
    try {
      await fixture.make().login();
      await fixture.expire();
      const entry = pathToFileURL(join(process.cwd(), "src/llm/auth/chatgpt.ts")).href;
      const script = `import { ChatGPTAuth } from ${JSON.stringify(entry)};
        const auth = new ChatGPTAuth({home: process.env.NAVO_TEST_AUTH_HOME, openBrowser: async () => {},
          fetch: async () => { console.log('REFRESH'); await new Promise(r => setTimeout(r, 300));
            return Response.json({access_token:'rotated-access', refresh_token:'rotated-refresh', token_type:'Bearer', expires_in:3600}); }});
        console.log(await auth.accessToken());`;
      const launch = () => execute(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
        cwd: process.cwd(), env: { ...process.env, NAVO_TEST_AUTH_HOME: fixture.home }, windowsHide: true,
      });
      const results = await Promise.all([launch(), launch()]);
      expect(results.map(result => result.stdout).join("").match(/REFRESH/g)).toHaveLength(1);
      expect(results.every(result => result.stdout.includes("rotated-access"))).toBe(true);
      const saved = await fixture.store.transaction(async state => state.accounts[0]!.credentials!.refreshToken);
      expect(saved).toBe("rotated-refresh");
    } finally { await fixture.close(); }
  }, 30_000);

  it("cancels a refresh waiter without cancelling the shared rotation", async () => {
    const fixture = await authFixture();
    try {
      const auth = fixture.make();
      const account = await auth.login();
      await fixture.expire();
      let resume!: () => void;
      fixture.setRefreshGate(new Promise<void>(resolve => { resume = resolve; }));
      const controller = new AbortController();
      const cancelled = auth.accessToken(account.id, controller.signal);
      const cancellation = expect(cancelled).rejects.toThrow("wait cancelled");
      await fixture.startedRefresh;
      controller.abort(new Error("wait cancelled"));
      await cancellation;
      resume();
      expect(await auth.accessToken(account.id)).toBe("access-1");
      expect(fixture.refreshCount).toBe(1);
    } finally { await fixture.close(); }
  }, 20_000);

  it("does not restore tokens after concurrent logout and refresh", async () => {
    const fixture = await authFixture();
    try {
      const auth = fixture.make();
      await auth.login();
      await fixture.expire();
      const refreshed = auth.accessToken();
      const signedOut = fixture.make().logout();
      await Promise.allSettled([refreshed, signedOut]);
      const saved = await fixture.store.transaction(async state => state.accounts[0]!);
      expect(saved.credentials).toBeUndefined();
      expect(saved.status).toBe("signed-out");
    } finally { await fixture.close(); }
  }, 20_000);

  it("clears invalid grants and reports unconfirmed remote revocation without retaining tokens", async () => {
    const fixture = await authFixture();
    try {
      const auth = fixture.make();
      const account = await auth.login();
      await fixture.expire();
      fixture.setFailure("invalid_grant");
      await expect(auth.accessToken()).rejects.toMatchObject({ code: "invalid_grant" });
      expect((await auth.accounts()).accounts[0]?.status).toBe("reauth-required");
      fixture.setFailure();
      await auth.login({ accountId: account.id });
      fixture.setRevokeStatus(503);
      await expect(auth.logout()).rejects.toMatchObject({ code: "revocation-unconfirmed" });
      expect((await auth.accounts()).accounts[0]?.status).toBe("signed-out");
      expect(await auth.logout()).toEqual({ revoked: false });
    } finally { await fixture.close(); }
  }, 30_000);

  it("aborts an account catalog query when the same owner signs out", async () => {
    const fixture = await authFixture();
    try {
      const auth = fixture.make();
      await auth.login();
      let resume!: () => void;
      fixture.setModelGate(new Promise<void>(resolve => { resume = resolve; }));
      const queried = auth.models();
      const rejected = expect(queried).rejects.toMatchObject({ code: "signed-out" });
      await fixture.startedModel;
      await auth.logout();
      resume();
      await rejected;
    } finally { await fixture.close(); }
  }, 20_000);

  it("rejects malformed account catalogs", async () => {
    const fixture = await authFixture();
    try {
      const auth = fixture.make();
      await auth.login();
      fixture.setCatalog({ data: [] });
      await expect(auth.models()).rejects.toMatchObject({ code: "invalid-models" });
    } finally { await fixture.close(); }
  }, 20_000);
});
