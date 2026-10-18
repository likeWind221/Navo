import type { Context } from "cordis";

import type { NodeId, TurnId } from "../brand/ids.js";
import type { NodeSnapshot } from "../node/model.js";
import { formatSystemReminder } from "../session/reminder.js";
import type { SessionEvent, TurnEndStatus } from "../session/types.js";

export const CHECKLIST_REPLY_CHARS = 1_500;
export const CHECKLIST_RESOURCE_LIMIT = 20;
export const CHECKLIST_MESSAGE_LIMIT = 5;
export const CHECKLIST_MESSAGE_CHARS = 500;
export const CHECKLIST_NOTE_CHARS = 300;

export interface NodeTurnRecord {
  readonly turnId: TurnId;
  readonly status: TurnEndStatus;
  readonly startedAt: string;
  readonly endedAt: string;
}

export function lastEndedTurn(events: readonly SessionEvent[]): NodeTurnRecord | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const ended = events[index]!;
    if (ended.type !== "turn-ended") continue;
    const { turnId, status } = ended.data;
    for (let before = index - 1; before >= 0; before -= 1) {
      const started = events[before]!;
      if (started.type === "turn-started" && started.data.turnId === turnId) {
        return { turnId, status, startedAt: started.timestamp, endedAt: ended.timestamp };
      }
    }
    return { turnId, status, startedAt: ended.timestamp, endedAt: ended.timestamp };
  }
  return undefined;
}

export function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…[truncated ${value.length - limit} chars]`;
}

export function buildChecklist(
  ctx: Context,
  snapshot: NodeSnapshot,
  turn: NodeTurnRecord | undefined,
  rework: { readonly used: number; readonly remaining: number },
): string {
  const nodeId: NodeId = snapshot.node.id;
  const events = snapshot.sessionId === undefined ? [] : ctx.sessions.getEvents(snapshot.sessionId);
  const inTurn = (timestamp: string): boolean => turn !== undefined
    && timestamp >= turn.startedAt && timestamp <= turn.endedAt;

  const reply = turn === undefined ? undefined : lastAssistantText(events, turn.turnId);
  const resources = turn === undefined ? [] : ctx.resources.listByProject(snapshot.node.projectId)
    .filter(resource => resource.owner.kind === "node" && resource.owner.nodeId === nodeId
      && inTurn(resource.updatedAt));
  const messages = turn === undefined ? [] : ctx.mailbox.getHistory(snapshot.node.projectId)
    .filter(message => message.sender.kind === "node" && message.sender.nodeId === nodeId
      && inTurn(message.timestamp));

  const submission = snapshot.submission;
  const criteria = snapshot.node.objective.acceptanceCriteria.map((criterion, index) => ({
    index: index + 1,
    criterion,
  }));

  return formatSystemReminder(
    "review checklist for the Node you are about to check. Node state and acceptance criteria come from the system. completionSignal, when present, is the system's record of the current validated Node submission: its fields and self-check values were actually submitted. Validation covers structure only, not task correctness. Each completionSignal.criteria index is the 1-based index in criteria. Its satisfied value records the Node's claim, not a verified fact about task completion; independently verify the work using evidence. A null completionSignal means no current submission.",
    {
      node: {
        id: String(nodeId),
        title: snapshot.node.objective.title,
        revision: snapshot.revision,
        status: snapshot.status,
        requirement: snapshot.node.requirement,
      },
      neverExecuted: snapshot.sessionId === undefined,
      turn: turn === undefined ? null : { id: String(turn.turnId), status: turn.status, endedAt: turn.endedAt },
      reworks: { used: rework.used, mainMayStillRework: rework.remaining },
      lastReview: snapshot.lastReview === undefined ? null : {
        decision: snapshot.lastReview.decision,
        reason: clip(snapshot.lastReview.reason, CHECKLIST_NOTE_CHARS),
      },
      completionSignal: submission === undefined ? null : {
        source: "validated-node-submission",
        summary: clip(submission.summary, CHECKLIST_REPLY_CHARS),
        resourceIds: submission.resourceIds.map(String),
        criteria: submission.criteria.map((check, index) => ({
          index: index + 1,
          satisfied: check.satisfied,
          note: clip(check.note, CHECKLIST_NOTE_CHARS),
        })),
        remaining: submission.remaining.map(item => clip(item, CHECKLIST_NOTE_CHARS)),
        submittedAt: submission.submittedAt,
      },
      criteria,
      lastReply: reply === undefined ? null : clip(reply, CHECKLIST_REPLY_CHARS),
      resourcesFromThisTurn: resources.slice(0, CHECKLIST_RESOURCE_LIMIT).map(resource => ({
        id: String(resource.id),
        name: resource.name,
        type: resource.type,
        revision: resource.revision,
      })),
      resourcesOmitted: Math.max(0, resources.length - CHECKLIST_RESOURCE_LIMIT),
      messagesToMain: messages.slice(-CHECKLIST_MESSAGE_LIMIT).map(message => ({
        sequence: message.sequence,
        body: clip(message.body, CHECKLIST_MESSAGE_CHARS),
      })),
      evidenceTools: {
        resources: "fetch_resource",
        process: "read_node_turn",
      },
    },
  );
}

function lastAssistantText(events: readonly SessionEvent[], turnId: TurnId): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type !== "assistant-message" || event.data.turnId !== turnId) continue;
    const text = event.data.message.content
      .flatMap(block => block.type === "text" ? [block.text] : [])
      .join("\n")
      .trim();
    if (text !== "") return text;
  }
  return undefined;
}
