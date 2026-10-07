import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Context } from "cordis";

import type { ProjectId, SessionId, TurnId } from "../../src/brand/ids.js";
import type { Message } from "../../src/llm/types.js";
import type { SessionEvent } from "../../src/session/types.js";

export interface TurnEvidence {
  readonly calls: readonly string[];
  readonly answers: readonly string[];
  readonly errors: readonly unknown[];
  readonly unrecovered: readonly unknown[];
  readonly succeeded: readonly { readonly name: string; readonly arguments: string }[];
  readonly record: Record<string, unknown>;
}

export function captureTurn(
  app: Context,
  projectId: ProjectId,
  sessionId: SessionId,
  turnId: TurnId,
): TurnEvidence {
  const events = app.sessions.getEvents(sessionId)
    .filter(event => "turnId" in event.data && event.data.turnId === turnId);
  const assistant = events.flatMap(event => event.type === "assistant-message" ? [event.data.message] : []);
  const calls = assistant.flatMap(message => message.content.flatMap(block => block.type === "tool-call" ? [block] : []));
  const results = new Map(events.flatMap(event => event.type === "tool-call-result"
    ? event.data.message.content.map(block => [block.toolCallId, block] as const) : []));
  const errors = events.flatMap(event => event.type === "error" ? [event.data] : []);
  const unrecovered = errors.filter(error => {
    const failed = calls.findIndex(call => call.id === error.toolCallId);
    return error.source !== "tool" || failed < 0 || !calls.slice(failed + 1)
      .some(call => call.name === calls[failed]!.name && results.get(call.id)?.isError === false);
  });
  return {
    calls: calls.map(call => call.name),
    answers: assistant.flatMap(message => message.content.flatMap(block => block.type === "text" ? [block.text] : [])),
    errors,
    unrecovered,
    succeeded: calls.flatMap(call => results.get(call.id)?.isError === false ? [{ name: call.name, arguments: call.arguments }] : []),
    record: {
      sessionId,
      turnId,
      requests: events.flatMap(event => event.type === "llm-requested" ? [requestRecord(event)] : []),
      calls: calls.map(call => {
        const result = results.get(call.id);
        return {
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          result: result === undefined ? null : {
            isError: result.isError,
            text: result.content.flatMap(block => block.type === "text" ? [block.text] : []).join(""),
          },
        };
      }),
      errors,
      unrecovered,
      state: projectState(app, projectId),
    },
  };
}

export function projectState(app: Context, projectId: ProjectId) {
  return {
    roadmapRevision: app.roadmaps.get(projectId)?.revision ?? null,
    nodes: app.nodes.getByProject(projectId).map(value => ({
      id: value.node.id,
      title: value.node.kind === "work" ? value.node.objective.title : value.node.title,
      status: value.status,
      revision: value.revision,
      sessionId: value.sessionId ?? null,
    })),
    resources: app.resources.listByProject(projectId).map(value => ({
      id: value.id,
      name: value.name,
      type: value.type,
      entryRef: value.entryRef,
      owner: value.owner,
      access: value.access,
      revision: value.revision,
    })),
    mailbox: app.mailbox.getHistory(projectId).map(value => ({
      sequence: value.sequence,
      sender: value.sender,
      recipient: value.recipient,
      body: value.body,
    })),
  };
}

export async function writeEvidence(directory: string, name: string, value: unknown): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${name}.json`);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

function requestRecord(event: Extract<SessionEvent, { type: "llm-requested" }>) {
  return {
    stepId: event.data.stepId,
    model: event.data.model,
    tools: event.data.tools?.map(tool => tool.name) ?? [],
    messages: event.data.messages.map(withoutReasoning),
  };
}

function withoutReasoning(message: Message) {
  return { ...message, content: message.content.filter(block => block.type !== "reasoning") };
}
