import { randomUUID } from "node:crypto";

import { ipcMain } from "electron";
import type { WebContents } from "electron";

import { RpcError } from "../../../rpc/errors.js";
import type { RpcMethod, RpcStreamOptions } from "../../../rpc/index.js";
import {
  sessionContextFollowMethod,
  sessionContextMethod,
  sessionHistoryMethod,
} from "../../../rpc/session.js";
import type {
  SessionContextFollowInputV1,
  SessionContextSnapshotV1,
  SessionHistoryV1,
} from "../../../rpc/session.js";
import type {
  DesktopSessionEvent,
  DesktopSessionFailure,
  DesktopSessionFollowHandle,
  DesktopSessionResult,
} from "../../shared/session.js";
import {
  DESKTOP_SESSION_FAILURE_MESSAGE_MAX_CHARS,
  isSessionFailureCode,
  parseDesktopSubscriptionId,
} from "../../shared/session/validation.js";
import {
  SESSION_CONTEXT_EVENT_CHANNEL,
  SESSION_CONTEXT_FOLLOW_CANCEL_CHANNEL,
  SESSION_CONTEXT_FOLLOW_START_CHANNEL,
  SESSION_CONTEXT_GET_CHANNEL,
  SESSION_CONTEXT_HISTORY_CHANNEL,
} from "../../shared/session/channels.js";

export interface SessionContextHost {
  stream<TInput, TOutput>(
    method: RpcMethod<TInput, TOutput>,
    input: TInput,
    options?: RpcStreamOptions,
  ): AsyncIterable<TOutput>;
}

export interface SessionContextTarget {
  readonly ownerId: number;
  isDestroyed(): boolean;
  send(update: DesktopSessionEvent): void;
}

interface ActiveFollow {
  readonly subscriptionId: string;
  readonly input: SessionContextFollowInputV1;
  readonly target: SessionContextTarget;
  readonly controller: AbortController;
  cancelled: boolean;
}

export class SessionContextController {
  private readonly follows = new Map<string, ActiveFollow>();
  private disposed = false;

  constructor(private readonly host: SessionContextHost) {}

  getContext(candidate: unknown): Promise<DesktopSessionResult<SessionContextSnapshotV1>> {
    return call(this.host, sessionContextMethod, candidate);
  }

  getHistory(candidate: unknown): Promise<DesktopSessionResult<SessionHistoryV1>> {
    return call(this.host, sessionHistoryMethod, candidate);
  }

  startContextFollow(
    target: SessionContextTarget,
    candidate: unknown,
  ): DesktopSessionResult<DesktopSessionFollowHandle> {
    if (this.disposed) return failed("bridge-closed", "Session bridge is closed");
    let input: SessionContextFollowInputV1;
    try {
      input = sessionContextFollowMethod.parseInput(candidate);
    } catch {
      return failed("invalid-input", "The session request is invalid");
    }
    const subscriptionId = randomUUID();
    const follow: ActiveFollow = {
      subscriptionId,
      input,
      target,
      controller: new AbortController(),
      cancelled: false,
    };
    this.follows.set(subscriptionId, follow);
    void this.run(follow);
    return { type: "ok", value: { subscriptionId } };
  }

  cancelContextFollow(ownerId: number, candidate: unknown): DesktopSessionResult<null> {
    let subscriptionId: string;
    try {
      subscriptionId = parseDesktopSubscriptionId(candidate);
    } catch {
      return failed("invalid-input", "The subscription identity is invalid");
    }
    const follow = this.follows.get(subscriptionId);
    if (follow?.target.ownerId === ownerId) this.cancel(follow, "Renderer cancelled the subscription");
    return { type: "ok", value: null };
  }

  cancelOwner(ownerId: number): void {
    for (const follow of this.follows.values()) {
      if (follow.target.ownerId === ownerId) this.cancel(follow, "Renderer was destroyed");
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const follow of this.follows.values()) this.cancel(follow, "Session bridge was disposed");
  }

  private cancel(follow: ActiveFollow, reason: string): void {
    follow.cancelled = true;
    follow.controller.abort(reason);
  }

  private async run(follow: ActiveFollow): Promise<void> {
    let received = false;
    try {
      for await (const candidate of this.host.stream(
        sessionContextFollowMethod,
        follow.input,
        { signal: follow.controller.signal },
      )) {
        const event = sessionContextFollowMethod.parseOutput(candidate);
        if (!received && event.type !== "snapshot") {
          throw new RpcError("invalid-output", "Session context follow must start with a snapshot");
        }
        received = true;
        const sessionId = event.type === "compaction-event"
          ? event.event.sessionId : event.snapshot.sessionId;
        if (sessionId !== follow.input.sessionId) {
          throw new RpcError("invalid-output", "Session context follow leaked another Session");
        }
        this.publish(follow, { type: "context-event", subscriptionId: follow.subscriptionId, event });
      }
      if (!follow.cancelled && !this.disposed) {
        this.publish(follow, {
          type: "context-follow-error",
          subscriptionId: follow.subscriptionId,
          failure: { code: "host-unavailable", message: "Session context follow ended" },
        });
      }
    } catch (error: unknown) {
      if (!follow.cancelled && !this.disposed) {
        this.publish(follow, {
          type: "context-follow-error",
          subscriptionId: follow.subscriptionId,
          failure: toSessionFailure(error),
        });
      }
    } finally {
      if (this.follows.get(follow.subscriptionId) === follow) {
        this.follows.delete(follow.subscriptionId);
      }
    }
  }

  private publish(follow: ActiveFollow, update: DesktopSessionEvent): void {
    if (this.follows.get(follow.subscriptionId) !== follow || follow.target.isDestroyed()) return;
    follow.target.send(update);
  }
}

async function call<TInput, TOutput>(
  host: SessionContextHost,
  method: RpcMethod<TInput, TOutput>,
  candidate: unknown,
): Promise<DesktopSessionResult<TOutput>> {
  let input: TInput;
  try {
    input = method.parseInput(candidate);
  } catch {
    return failed("invalid-input", "The session request is invalid");
  }
  try {
    const outputs: TOutput[] = [];
    for await (const output of host.stream(method, input)) outputs.push(method.parseOutput(output));
    const [value] = outputs;
    if (outputs.length !== 1 || value === undefined) {
      return failed("invalid-output", "Session method must return exactly one result");
    }
    return { type: "ok", value };
  } catch (error: unknown) {
    return { type: "failed", failure: toSessionFailure(error) };
  }
}

function toSessionFailure(error: unknown): DesktopSessionFailure {
  if (!(error instanceof RpcError)) {
    return { code: "host-unavailable", message: "Kernel Host is unavailable" };
  }
  switch (error.code) {
    case "remote-error": {
      const remote = error.failure;
      if (remote !== undefined && isSessionFailureCode(remote.code)) {
        return { code: remote.code, message: bounded(remote.message), details: remote.details };
      }
      return { code: "internal", message: bounded(`${remote?.code ?? "remote-error"}: ${error.message}`) };
    }
    case "invalid-output":
    case "invalid-frame":
      return { code: "invalid-output", message: "Kernel Host returned a malformed session result" };
    case "invalid-input":
      return { code: "invalid-input", message: "The session request is invalid" };
    case "cancelled":
    case "connection-closed":
    case "duplicate-request":
    case "method-not-found":
      return { code: "host-unavailable", message: `Kernel Host is unavailable (${error.code})` };
  }
}

function bounded(message: string): string {
  const text = message.trim() || "Session request failed";
  return text.length > DESKTOP_SESSION_FAILURE_MESSAGE_MAX_CHARS
    ? text.slice(0, DESKTOP_SESSION_FAILURE_MESSAGE_MAX_CHARS)
    : text;
}

function failed<T>(code: DesktopSessionFailure["code"], message: string): DesktopSessionResult<T> {
  return { type: "failed", failure: { code, message } };
}

export function registerSessionContextIpc(controller: SessionContextController): () => void {
  ipcMain.handle(SESSION_CONTEXT_GET_CHANNEL, (_event, candidate: unknown) =>
    controller.getContext(candidate));
  ipcMain.handle(SESSION_CONTEXT_HISTORY_CHANNEL, (_event, candidate: unknown) =>
    controller.getHistory(candidate));
  ipcMain.handle(SESSION_CONTEXT_FOLLOW_START_CHANNEL, (event, candidate: unknown) =>
    controller.startContextFollow(createTarget(event.sender), candidate));
  ipcMain.handle(SESSION_CONTEXT_FOLLOW_CANCEL_CHANNEL, (event, candidate: unknown) =>
    controller.cancelContextFollow(event.sender.id, candidate));
  return () => {
    ipcMain.removeHandler(SESSION_CONTEXT_GET_CHANNEL);
    ipcMain.removeHandler(SESSION_CONTEXT_HISTORY_CHANNEL);
    ipcMain.removeHandler(SESSION_CONTEXT_FOLLOW_START_CHANNEL);
    ipcMain.removeHandler(SESSION_CONTEXT_FOLLOW_CANCEL_CHANNEL);
  };
}

function createTarget(sender: WebContents): SessionContextTarget {
  return {
    ownerId: sender.id,
    isDestroyed: () => sender.isDestroyed(),
    send: (update: DesktopSessionEvent) => sender.send(SESSION_CONTEXT_EVENT_CHANNEL, update),
  };
}
