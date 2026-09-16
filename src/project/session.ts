import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context } from "cordis";

import type { TurnModelConfig, TurnResult } from "../agent/types.js";
import { createMessageId } from "../brand/ids.js";
import type { ProjectId, SessionId } from "../brand/ids.js";
import { requireMainBinding } from "./binding.js";
import { ProjectError } from "./errors.js";
import type { ProjectSnapshot } from "./model.js";
import { createMainAgentProfile } from "./profile.js";

export interface MainSessionServiceConfig {
  readonly model: TurnModelConfig;
}

export interface MainSessionMessageInput {
  readonly projectId: ProjectId;
  readonly text: string;
  readonly signal?: AbortSignal;
}

export interface MainSessionTurnResult {
  readonly projectId: ProjectId;
  readonly sessionId: SessionId;
  readonly turn: TurnResult;
}

declare module "cordis" {
  interface Context {
    mainSessions: MainSessionService;
  }
}

export class MainSessionService extends Service {
  static inject = ["projects", "nodes", "agentRuntime"];

  private readonly model: TurnModelConfig;

  constructor(ctx: Context, config: MainSessionServiceConfig) {
    super(ctx, "mainSessions");
    this.model = snapshotModel(config?.model);
  }

  async sendMessage(input: MainSessionMessageInput): Promise<MainSessionTurnResult> {
    const text = requireMessageText(input.text);
    const project = this.requireProject(input.projectId);
    const binding = requireMainBinding(this.ctx, project.mainSessionId, project.id);
    const profile = createMainAgentProfile(project);
    const turn = await this.ctx.agentRuntime.runTurn({
      sessionId: binding.sessionId,
      userMessage: {
        id: createMessageId(randomUUID()),
        role: "user",
        content: [{ type: "text", text }],
      },
      model: this.model,
      systemPrompt: profile.systemPrompt,
      toolNames: profile.toolNames,
      signal: input.signal,
    });
    return Object.freeze({
      projectId: binding.projectId,
      sessionId: binding.sessionId,
      turn,
    });
  }

  private requireProject(projectId: ProjectId): ProjectSnapshot {
    const project = this.ctx.projects.get(projectId);
    if (project === undefined) {
      throw new ProjectError("project-not-found", `Project '${projectId}' was not found.`);
    }
    if (project.status !== "active") {
      throw new ProjectError("project-unavailable", `Project '${projectId}' is not active.`);
    }
    return project;
  }
}

function snapshotModel(value: TurnModelConfig | undefined): TurnModelConfig {
  if (value === undefined || typeof value.provider !== "string" || !value.provider.trim()
      || typeof value.model !== "string" || !value.model.trim()) {
    throw new TypeError("MainSession Service requires a non-empty model provider and name.");
  }
  return Object.freeze(structuredClone(value));
}

function requireMessageText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProjectError("invalid-message", "MainSession message text must not be blank.");
  }
  return value;
}
