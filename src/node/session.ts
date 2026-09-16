import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context } from "cordis";

import type { TurnResult, TurnModelConfig } from "../agent/types.js";
import {
  createMessageId,
  createSessionId,
} from "../brand/ids.js";
import type { NodeId, SessionId } from "../brand/ids.js";
import { FILE_TOOL_SCHEMAS } from "../tools/builtins/file/types.js";
import { NodeError } from "./errors.js";
import type { NodeSnapshot } from "./model.js";
import { createNodeAgentProfile } from "./profile.js";

export interface NodeSessionServiceConfig {
  readonly model: TurnModelConfig;
}

export interface NodeSessionMessageInput {
  readonly nodeId: NodeId;
  readonly text: string;
  readonly signal?: AbortSignal;
}

export interface NodeSessionTurnResult {
  readonly nodeId: NodeId;
  readonly sessionId: SessionId;
  readonly turn: TurnResult;
}

declare module "cordis" {
  interface Context {
    nodeSessions: NodeSessionService;
  }
}

interface PendingTurn {
  readonly nodeId: NodeId;
  readonly controller: AbortController;
  readonly signal: AbortSignal;
}

export class NodeSessionService extends Service {
  static inject = ["nodes", "agentRuntime", "tools"];


  private readonly model: TurnModelConfig;

  private readonly tails = new Map<SessionId, Promise<void>>();

  private readonly active = new Map<SessionId, PendingTurn>();

  private readonly controllers = new Set<AbortController>();

  private unavailable = false;

  constructor(ctx: Context, config: NodeSessionServiceConfig) {
    super(ctx, "nodeSessions");
    this.model = snapshotModel(config?.model);
    this.ctx.effect(() => () => {
      this.unavailable = true;
      for (const controller of this.controllers) controller.abort();
    }, "nodeSessions.lifecycle");
  }

  start(input: NodeSessionMessageInput): Promise<NodeSessionTurnResult> {
    requireMessageText(input.text);
    const node = this.ctx.nodes.requireState(input.nodeId, "idle", "working");
    const sessionId = node.sessionId ?? this.bindNewSession(input.nodeId);
    return this.dispatch(input, sessionId);
  }

  sendMessage(input: NodeSessionMessageInput): Promise<NodeSessionTurnResult> {
    const node = this.requireNode(input.nodeId);
    if (node.sessionId === undefined) {
      throw new NodeError(
        "node-session-required",
        `Node '${input.nodeId}' has not started a Session.`,
      );
    }
    return this.dispatch(input, node.sessionId);
  }

  stop(nodeId: NodeId): boolean {
    const node = this.requireNode(nodeId);
    if (node.sessionId === undefined) return false;
    const turn = this.active.get(node.sessionId);
    if (turn === undefined || turn.nodeId !== nodeId || turn.signal.aborted) return false;
    turn.controller.abort();
    return true;
  }

  private dispatch(
    input: NodeSessionMessageInput,
    sessionId: SessionId,
  ): Promise<NodeSessionTurnResult> {
    const text = requireMessageText(input.text);
    const controller = new AbortController();
    const signal = input.signal === undefined
      ? controller.signal
      : AbortSignal.any([input.signal, controller.signal]);
    const pending: PendingTurn = { nodeId: input.nodeId, controller, signal };
    const previous = this.tails.get(sessionId) ?? Promise.resolve();
    this.controllers.add(controller);
    const result = previous.then(
      () => this.runQueued(sessionId, text, pending),
      () => this.runQueued(sessionId, text, pending),
    );
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(sessionId, tail);
    void tail.then(() => {
      if (this.tails.get(sessionId) === tail) this.tails.delete(sessionId);
    });
    return result;
  }

  private async runQueued(
    sessionId: SessionId,
    text: string,
    pending: PendingTurn,
  ): Promise<NodeSessionTurnResult> {
    let working = false;
    try {
      if (this.unavailable) {
        throw new NodeError(
          "node-session-service-unavailable",
          "NodeSession Service was disposed before the queued Turn started.",
        );
      }
      const node = this.ctx.nodes.requireState(pending.nodeId, "idle");
      if (node.sessionId !== sessionId) {
        throw new NodeError(
          "invalid-event-stream",
          `Node '${pending.nodeId}' no longer owns Session '${sessionId}'.`,
        );
      }
      const current = this.ctx.nodes.beginWork(pending.nodeId);
      working = true;
      this.active.set(sessionId, pending);
      const profile = createNodeAgentProfile(current, {
        allowFileRead: this.ctx.tools.schemas().some(
          (tool) => tool.name === FILE_TOOL_SCHEMAS.read.name,
        ),
      });
      const turn = await this.ctx.agentRuntime.runTurn({
        sessionId,
        userMessage: {
          id: createMessageId(randomUUID()),
          role: "user",
          content: [{ type: "text", text }],
        },
        model: this.model,
        systemPrompt: profile.systemPrompt,
        toolNames: profile.toolNames,
        signal: pending.signal,
      });
      return Object.freeze({ nodeId: pending.nodeId, sessionId, turn });
    } finally {
      if (working) this.ctx.nodes.endWork(pending.nodeId);
      if (this.active.get(sessionId) === pending) this.active.delete(sessionId);
      this.controllers.delete(pending.controller);
    }
  }

  private bindNewSession(nodeId: NodeId): SessionId {
    let sessionId: SessionId;
    do sessionId = createSessionId(randomUUID());
    while (this.ctx.nodes.getBySession(sessionId) !== undefined);
    return this.ctx.nodes.bindSession(nodeId, sessionId).sessionId!;
  }

  private requireNode(nodeId: NodeId): NodeSnapshot {
    const node = this.ctx.nodes.get(nodeId);
    if (node !== undefined) return node;
    throw new NodeError("node-not-found", `Node '${nodeId}' was not found.`);
  }
}

function snapshotModel(value: TurnModelConfig | undefined): TurnModelConfig {
  if (value === undefined || typeof value.provider !== "string" || !value.provider.trim()
      || typeof value.model !== "string" || !value.model.trim()) {
    throw new TypeError("NodeSession Service requires a non-empty model provider and name.");
  }
  return Object.freeze(structuredClone(value));
}

function requireMessageText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new NodeError("invalid-message", "NodeSession message text must not be blank.");
  }
  return value;
}
