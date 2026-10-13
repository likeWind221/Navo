import { createMessageId, createNodeId } from "../brand/ids.js";
import type { NodeId, ProjectId } from "../brand/ids.js";
import { MailboxError } from "./errors.js";
import type { MailboxParticipant, ProjectMessage } from "./model.js";

export function parseMailboxHistory(
  projectId: ProjectId,
  history: readonly unknown[],
  projects: ReadonlyMap<string, unknown> | { get(projectId: string): unknown },
  nodes: ReadonlyMap<string, { readonly node: { readonly projectId: string; readonly kind: string } } | undefined>,
): readonly ProjectMessage[] {
  if (projects instanceof Map ? !projects.has(projectId) : projects.get(projectId) === undefined) {
    throw new MailboxError("project-unavailable", "Mailbox restore requires an existing Project.");
  }
  const seenIds = new Set<string>();
  const restored = history.map((raw, index) => {
    const message = parseMessage(projectId, raw, index + 1, nodes);
    if (seenIds.has(message.id)) throw new MailboxError("invalid-history", "Mailbox history contains a duplicate message id.");
    seenIds.add(message.id);
    return message;
  });
  return Object.freeze(restored);
}

function parseMessage(
  projectId: ProjectId,
  raw: unknown,
  expectedSequence: number,
  nodes: ReadonlyMap<string, { readonly node: { readonly projectId: string; readonly kind: string } } | undefined>,
): ProjectMessage {
  if (!raw || typeof raw !== "object") throw new MailboxError("invalid-history", "Mailbox history contains an invalid message.");
  const value = raw as Record<string, unknown>;
  if (
    value.version !== 1
    || typeof value.id !== "string"
    || value.projectId !== projectId
    || value.sequence !== expectedSequence
    || typeof value.timestamp !== "string"
    || Number.isNaN(Date.parse(value.timestamp))
    || typeof value.body !== "string"
  ) throw new MailboxError("invalid-history", "Mailbox history contains an invalid message envelope.");
  if (value.body.trim().length === 0) throw new MailboxError("invalid-message", "Mailbox message body must be non-empty.");
  const sender = parseParticipant(value.sender);
  const recipient = parseParticipant(value.recipient);
  requireRoute(projectId, sender, recipient, nodes);
  return Object.freeze({
    version: 1,
    id: createMessageId(value.id),
    projectId,
    sequence: expectedSequence,
    timestamp: value.timestamp,
    sender,
    recipient,
    body: value.body,
  });
}

function parseParticipant(value: unknown): MailboxParticipant {
  if (!value || typeof value !== "object") throw new MailboxError("invalid-history", "Mailbox participant is invalid.");
  const participant = value as Record<string, unknown>;
  if (participant.kind === "main") return Object.freeze({ kind: "main" });
  if (participant.kind === "node" && typeof participant.nodeId === "string") {
    return Object.freeze({ kind: "node", nodeId: createNodeId(participant.nodeId) });
  }
  throw new MailboxError("invalid-history", "Mailbox participant is invalid.");
}

function requireRoute(
  projectId: ProjectId,
  sender: MailboxParticipant,
  recipient: MailboxParticipant,
  nodes: ReadonlyMap<string, { readonly node: { readonly projectId: string; readonly kind: string } } | undefined>,
): void {
  const nodeToMain = sender.kind === "node" && recipient.kind === "main";
  const mainToNode = sender.kind === "main" && recipient.kind === "node";
  if (!nodeToMain && !mainToNode) throw new MailboxError("invalid-route", "Mailbox only supports Node-to-Main and Main-to-Node routes.");
  if (sender.kind === "node") requireWorkNode(projectId, sender.nodeId, nodes);
  if (recipient.kind === "node") requireWorkNode(projectId, recipient.nodeId, nodes);
}

function requireWorkNode(
  projectId: ProjectId,
  nodeId: NodeId,
  nodes: ReadonlyMap<string, { readonly node: { readonly projectId: string; readonly kind: string } } | undefined>,
): void {
  const node = nodes.get(nodeId);
  if (!node || node.node.projectId !== projectId || node.node.kind !== "work") {
    throw new MailboxError("node-unavailable", "Mailbox Node must be a work Node in the same Project.");
  }
}
