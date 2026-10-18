import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "cordis";
import type { GenerateRequest } from "../../../src/llm/types.js";
import { afterEach } from "vitest";

import { createApp } from "../../../src/app.js";
import type { TurnModelConfig } from "../../../src/agent/types.js";
import { createMessageId, createStepId, createTurnId } from "../../../src/brand/ids.js";
import type { SessionId } from "../../../src/brand/ids.js";
import { MockLLMAdapter } from "../../../src/llm/adapters/mock.js";
import type { LLMAdapter } from "../../../src/llm/adapter.js";
import type { MockLLMEntry } from "../../../src/llm/adapters/mock.js";
import type { Message, ModelEvent } from "../../../src/llm/types.js";
import type { SessionEvent } from "../../../src/session/types.js";
import { StorageService } from "../../../src/storage/database.js";
import { temporaryDatabase } from "../../helpers/storage.js";

export type RequestPurpose = "summary" | "task";

export interface RequestRecord {
  readonly purpose: RequestPurpose;
  readonly request: GenerateRequest;
}

const apps = new Set<Context>();
const roots: string[] = [];

afterEach(async () => {
  await Promise.all([...apps].map(app => app.fiber.dispose()));
  apps.clear();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

export function requestPurpose(request: GenerateRequest): RequestPurpose {
  const instruction = request.messages.some(message => message.content.some(
    block => block.type === "text" && block.text.includes("Compress the conversation above"),
  ));
  if (request.tools === undefined && instruction) return "summary";
  if (request.tools !== undefined && !instruction) return "task";
  throw new Error("LLM request is neither a task nor a summary request.");
}

class ScriptedAdapter implements LLMAdapter {
  readonly records: RequestRecord[] = [];
  private ctx: Context | undefined;

  constructor(
    private readonly tasks: MockLLMEntry[],
    private readonly summary: () => MockLLMEntry,
  ) {}

  attach(ctx: Context): void {
    this.ctx = ctx;
  }

  async *stream(request: GenerateRequest): AsyncIterable<ModelEvent> {
    const purpose = requestPurpose(request);
    this.records.push({ purpose, request });
    if (purpose === "summary") {
      this.requireActiveCompactions(1);
      yield* new MockLLMAdapter([this.summary()]).stream(request);
      return;
    }
    this.requireActiveCompactions(0);
    const entry = this.tasks.shift();
    if (entry === undefined) throw new Error("Mock task script was exhausted by an unexpected request.");
    yield* new MockLLMAdapter([entry]).stream(request);
  }

  private requireActiveCompactions(expected: number): void {
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error("Mock adapter is not attached to an application.");
    const sessionIds = new Set<string>();
    for (const project of ctx.projects.list()) {
      sessionIds.add(project.mainSessionId);
      for (const node of ctx.nodes.getByProject(project.id)) {
        if (node.sessionId !== undefined) sessionIds.add(node.sessionId);
      }
    }
    let active = 0;
    for (const sessionId of sessionIds) {
      const events = ctx.sessions.getEvents(sessionId as SessionId);
      active += events.filter(event => event.type === "compaction-started").length;
      active -= events.filter(event => event.type === "compaction-ended").length;
    }
    if (active !== expected) {
      throw new Error(`Expected ${expected} active compaction transaction(s), observed ${active}.`);
    }
  }
}

export interface WorldOptions {
  readonly model: TurnModelConfig;
  readonly tasks: MockLLMEntry[];
  readonly summary?: () => MockLLMEntry;
  readonly fileTools?: boolean;
}

export async function createWorld(options: WorldOptions) {
  const path = await temporaryDatabase(roots, "navo-f127-storage-");
  const workspaceRoot = await mkdtemp(join(tmpdir(), "navo-f127-workspace-"));
  roots.push(workspaceRoot);

  let consumed = 0;
  let consumedPurposes: RequestPurpose[] = [];
  let adapter: ScriptedAdapter | undefined;

  const open = async (): Promise<Context> => {
    const app = await createApp({
      storage: { path },
      runtime: { maxModelRetries: 0 },
      node: { session: { model: options.model } },
      ...(options.fileTools === true
        ? {
            tools: {
              file: {
                resolveFileEnvironment: async () => {
                  throw new Error("File access requires a Project-bound Session.");
                },
              },
            },
          }
        : {}),
    });
    adapter = new ScriptedAdapter(options.tasks, options.summary ?? (() => {
      throw new Error("No summary response was scripted.");
    }));
    adapter.attach(app);
    app.llm.registerAdapter("mock", adapter);
    apps.add(app);
    return app;
  };

  const close = async (app: Context): Promise<void> => {
    consumed += adapter!.records.length;
    consumedPurposes = [...consumedPurposes, ...adapter!.records.map(record => record.purpose)];
    apps.delete(app);
    await app.fiber.dispose();
  };

  const appendSessionEvents = async (
    sessionId: SessionId,
    projectId: string,
    events: readonly unknown[],
    firstSeq: number,
  ): Promise<void> => {
    const ctx = new Context();
    try {
      await ctx.plugin(StorageService, { path });
      ctx.storage.write(tx => tx.appendEvents({
        domain: "session",
        ownerId: sessionId,
        projectId,
        firstSeq,
        events,
      }), () => {});
    } finally {
      await ctx.fiber.dispose();
    }
  };

  return {
    path,
    workspaceRoot,
    open,
    close,
    appendSessionEvents,
    restart: async (app: Context) => {
      await close(app);
      return open();
    },
    requests: () => consumed + (adapter?.records.length ?? 0),
    purposes: () => [...consumedPurposes, ...(adapter?.records.map(record => record.purpose) ?? [])],
    records: () => adapter?.records ?? [],
    taskRequests: () => adapter?.records.filter(record => record.purpose === "task") ?? [],
  };
}

export type World = Awaited<ReturnType<typeof createWorld>>;

export async function createProject(
  app: Context,
  workspaceRoot: string,
  titles: readonly string[],
) {
  const project = app.projects.create({ name: "Compaction Project", goal: "Complete the approved work plan." });
  await app.projectWorkspaces.create(project.id, workspaceRoot);
  const nodes = titles.map(title => app.nodes.create({
    projectId: project.id,
    objective: {
      title,
      description: `Execute ${title}`,
      acceptanceCriteria: [`${title} complete`],
    },
  }));
  const nodeIds = nodes.map(node => node.node.id);
  app.roadmaps.create({
    definition: {
      projectId: project.id,
      nodes: nodeIds,
      edges: nodeIds.length === 2 ? [{ from: nodeIds[0]!, to: nodeIds[1]! }] : [],
    },
    reason: "Human-approved plan",
  });
  return { project, nodeIds };
}

export function seedHistory(
  app: Context,
  sessionId: SessionId,
  pairs: number,
  size: number,
): void {
  for (let index = 0; index < pairs; index += 1) {
    app.sessions.append({
      type: "user-message",
      sessionId,
      data: { message: {
        id: createMessageId(`${sessionId}-user-${index}`),
        role: "user",
        content: [{ type: "text", text: `question ${index}:${"q".repeat(size)}` }],
      } },
    });
    app.sessions.append({
      type: "assistant-message",
      sessionId,
      data: {
        turnId: createTurnId(`seed-turn-${index}`),
        stepId: createStepId(`seed-step-${index}`),
        message: {
          id: createMessageId(`${sessionId}-assistant-${index}`),
          role: "assistant",
          content: [{ type: "text", text: `answer ${index}:${"a".repeat(size)}` }],
        },
        finishReason: { kind: "stop" },
      },
    });
  }
}

export function messageText(request: GenerateRequest): string {
  return messagesText(request.messages);
}

export function messagesText(messages: readonly Message[]): string {
  return messages.flatMap(message => message.content).flatMap(block => {
    if (block.type === "text") return [block.text];
    if (block.type === "tool-result") return block.content.flatMap(item => item.type === "text" ? [item.text] : []);
    return [];
  }).join("\n");
}

export function sessionEvents(app: Context, sessionId: SessionId): readonly SessionEvent[] {
  return app.sessions.getEvents(sessionId);
}
