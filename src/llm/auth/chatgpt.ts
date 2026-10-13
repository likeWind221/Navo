import { randomUUID } from "node:crypto";

import { ChatGPTAuthError } from "./chatgpt/error.js";
import { authorizeChatGPT } from "./chatgpt/flow.js";
import { listChatGPTModels } from "./chatgpt/models.js";
import { ChatGPTStore } from "./chatgpt/store.js";
import { ChatGPTTokens } from "./chatgpt/token.js";
import { SHARING_SCOPE } from "./chatgpt/types.js";
import type { AccountRecord, AuthState, ChatGPTAccount, ChatGPTModel } from "./chatgpt/types.js";

export { ChatGPTAuthError } from "./chatgpt/error.js";
export type { ChatGPTAccount, ChatGPTModel } from "./chatgpt/types.js";

export interface ChatGPTAuthOptions {
  readonly home?: string;
  readonly fetch?: typeof fetch;
  readonly openBrowser: (url: string) => Promise<void>;
}

export interface ChatGPTLoginOptions {
  readonly accountId?: string;
  readonly newAccount?: boolean;
  readonly signal?: AbortSignal;
}

export class ChatGPTAuth {
  private readonly store: ChatGPTStore;
  private readonly tokens: ChatGPTTokens;
  private readonly fetchImpl: typeof fetch;
  private readonly refreshing = new Map<string, Promise<string>>();
  private readonly queries = new Map<string, Set<AbortController>>();
  private signingIn = false;

  constructor(private readonly options: ChatGPTAuthOptions) {
    this.store = new ChatGPTStore(options.home);
    this.fetchImpl = options.fetch ?? fetch;
    this.tokens = new ChatGPTTokens(this.fetchImpl);
  }

  async accounts(): Promise<{ activeId?: string; accounts: ChatGPTAccount[] }> {
    return this.store.transaction(async state => ({
      ...(state.activeId === undefined ? {} : { activeId: state.activeId }),
      accounts: state.accounts.map(publicAccount),
    }));
  }

  async login(options: ChatGPTLoginOptions = {}): Promise<ChatGPTAccount> {
    if (this.signingIn) throw new ChatGPTAuthError("login-in-progress", "A ChatGPT login is already in progress.");
    if (options.newAccount && options.accountId) throw new TypeError("Choose a saved account or a new registration.");
    this.signingIn = true;
    const signal = options.signal === undefined ? AbortSignal.timeout(300_000)
      : AbortSignal.any([options.signal, AbortSignal.timeout(300_000)]);
    try {
      const prepared = await this.store.transaction(async state => {
        const id = options.accountId ?? state.activeId;
        const existing = options.newAccount ? undefined : id === undefined
          ? (state.accounts.length === 1 ? state.accounts[0] : undefined) : accountById(state, id);
        return { hostId: state.hostId, previous: existing === undefined ? undefined : structuredClone(existing) };
      }, signal);
      const previous = prepared.previous;
      const attempt = await authorizeChatGPT({
        hostId: prepared.hostId, signal, openBrowser: this.options.openBrowser,
        ...(previous === undefined ? {} : { clientId: previous.clientId }),
        ...(previous?.credentials === undefined ? {} : { idToken: previous.credentials.idToken }),
      });
      const pending = await this.store.transaction(async state => {
        signal.throwIfAborted();
        if (previous !== undefined) {
          const current = accountById(state, previous.id);
          if (JSON.stringify(current) !== JSON.stringify(previous)) changed();
          return structuredClone(current);
        }
        if (state.accounts.some(account => account.clientId === attempt.clientId)) changed();
        const account: AccountRecord = {
          id: randomUUID(), label: `ChatGPT ${state.accounts.length + 1}`,
          clientId: attempt.clientId, status: "pending",
        };
        state.accounts.push(account);
        return structuredClone(account);
      }, signal);
      const grant = await this.tokens.exchange(attempt.code, attempt.clientId,
        attempt.verifier, attempt.redirectUri, attempt.nonce, signal);
      if (pending.identity && (pending.identity.issuer !== grant.identity.issuer || pending.identity.subject !== grant.identity.subject)) {
        throw new ChatGPTAuthError("identity-mismatch", "The ChatGPT identity does not match the selected registration.");
      }
      return await this.store.transaction(async state => {
        signal.throwIfAborted();
        const current = accountById(state, pending.id);
        if (JSON.stringify(current) !== JSON.stringify(pending)) changed();
        current.identity = grant.identity;
        current.credentials = grant.credentials;
        current.status = "connected";
        state.activeId = current.id;
        return publicAccount(current);
      }, signal);
    } finally {
      this.signingIn = false;
    }
  }

  async accessToken(accountId?: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const id = await this.store.transaction(async state => selectedAccount(state, accountId).id, signal);
    let operation = this.refreshing.get(id);
    if (operation === undefined) {
      operation = this.resolveToken(id);
      this.refreshing.set(id, operation);
      void operation.finally(() => {
        if (this.refreshing.get(id) === operation) this.refreshing.delete(id);
      }).catch(() => undefined);
    }
    return waitFor(operation, signal);
  }

  async models(accountId?: string, signal?: AbortSignal): Promise<ChatGPTModel[]> {
    const controller = new AbortController();
    const deadline = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    const id = await this.store.transaction(async state => selectedAccount(state, accountId).id, deadline);
    let queries = this.queries.get(id);
    if (!queries) { queries = new Set(); this.queries.set(id, queries); }
    queries.add(controller);
    try {
      const accessToken = await this.accessToken(id, deadline);
      deadline.throwIfAborted();
      return await listChatGPTModels(accessToken, deadline, this.fetchImpl);
    } finally {
      queries.delete(controller);
      if (queries.size === 0) this.queries.delete(id);
    }
  }

  async logout(accountId?: string, signal?: AbortSignal): Promise<{ revoked: boolean }> {
    const deadline = signal === undefined ? AbortSignal.timeout(30_000)
      : AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    const result = await this.store.transaction(async state => {
      deadline.throwIfAborted();
      const account = selectedAccount(state, accountId);
      for (const query of this.queries.get(account.id) ?? []) query.abort(new ChatGPTAuthError("signed-out", "The ChatGPT account signed out."));
      let error: unknown;
      let revoked = false;
      try { revoked = await this.tokens.revoke(account, deadline); } catch (cause) { error = cause; }
      delete account.credentials;
      account.status = "signed-out";
      if (state.activeId === account.id) delete state.activeId;
      return { revoked, error };
    }, deadline);
    if (result.error !== undefined) {
      throw new ChatGPTAuthError("revocation-unconfirmed", "Signed out locally. Remote revocation was not confirmed; disconnect Navo in ChatGPT Settings.");
    }
    return { revoked: result.revoked };
  }

  private async resolveToken(id: string): Promise<string> {
    const outcome = await this.store.transaction(async state => {
      const account = accountById(state, id);
      if (account.status !== "connected" || !account.credentials) {
        return { error: new ChatGPTAuthError("login-required", "Sign in to ChatGPT before querying models or using the account.") };
      }
      if (account.credentials.expiresAt > Date.now() + 60_000) return { token: account.credentials.accessToken };
      try {
        account.credentials = await this.tokens.refresh(account, AbortSignal.timeout(30_000));
        return { token: account.credentials.accessToken };
      } catch (cause) {
        if (cause instanceof ChatGPTAuthError && ["invalid_grant", "invalid_client", "invalid-identity", "identity-mismatch", "permission-denied"].includes(cause.code)) {
          delete account.credentials;
          account.status = "reauth-required";
        }
        return { error: cause };
      }
    });
    if ("error" in outcome) throw outcome.error;
    return outcome.token;
  }
}

function accountById(state: AuthState, id: string): AccountRecord {
  const account = state.accounts.find(entry => entry.id === id);
  if (!account) throw new ChatGPTAuthError("account-not-found", "The selected ChatGPT registration does not exist.");
  return account;
}

function selectedAccount(state: AuthState, id?: string): AccountRecord {
  const selected = id ?? state.activeId ?? (state.accounts.length === 1 ? state.accounts[0]?.id : undefined);
  if (selected === undefined) throw new ChatGPTAuthError("login-required", "Sign in or select a ChatGPT account ID first.");
  return accountById(state, selected);
}

function publicAccount(account: AccountRecord): ChatGPTAccount {
  return { id: account.id, label: account.label, status: account.status,
    sharing: account.status === "connected" && (account.credentials?.scopes.includes(SHARING_SCOPE) ?? false),
    ...(account.identity?.email === undefined ? {} : { email: account.identity.email }) };
}

function changed(): never {
  throw new ChatGPTAuthError("account-changed", "The ChatGPT registration changed during login. Sign in again.");
}

function waitFor<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = (): void => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
