import { randomUUID } from "node:crypto";
import { Service } from "cordis";
import type { Context } from "cordis";
import { createMessageId, createNodeId } from "../brand/ids.js";
import type { NodeId, ProjectId } from "../brand/ids.js";
import { MailboxError } from "./errors.js";
import type {
  MailboxParticipant,
  PostFromMainInput,
  PostFromNodeInput,
  ProjectMessage,
} from "./model.js";

const emptyHistory: readonly ProjectMessage[] = Object.freeze([]);

export class MailboxStore extends Service {
  static inject = ["projects", "nodes"];

  private readonly histories = new Map<ProjectId, readonly ProjectMessage[]>();

  constructor(ctx: Context) {
    super(ctx, "mailbox");
  }

  getHistory(projectId: ProjectId): readonly ProjectMessage[] {
    return this.histories.get(projectId) ?? emptyHistory;
  }

  postFromNode(input: PostFromNodeInput): ProjectMessage {
    this.requireActiveProject(input.projectId);
    this.requireWorkNode(input.projectId, input.nodeId);
    return this.append(
      input.projectId,
      { kind: "node", nodeId: input.nodeId },
      { kind: "main" },
      input.body,
    );
  }

  postFromMain(input: PostFromMainInput): ProjectMessage {
    this.requireActiveProject(input.projectId);
    this.requireWorkNode(input.projectId, input.nodeId);
    return this.append(
      input.projectId,
      { kind: "main" },
      { kind: "node", nodeId: input.nodeId },
      input.body,
    );
  }

  restore(projectId: ProjectId, history: readonly unknown[]): readonly ProjectMessage[] {
    if (this.histories.has(projectId)) {
      throw new MailboxError("mailbox-already-restored", "Cannot overwrite an existing Project Mailbox.");
    }
    if (this.ctx.projects.get(projectId) === undefined) {
      throw new MailboxError("project-unavailable", "Mailbox restore requires an existing Project.");
    }

    const seenIds = new Set<string>();
    const restored = history.map((raw, index) => {
      const message = this.parseMessage(projectId, raw, index + 1);
      if (seenIds.has(message.id)) {
        throw new MailboxError("invalid-history", "Mailbox history contains a duplicate message id.");
      }
      seenIds.add(message.id);
      return message;
    });

    const frozen = Object.freeze(restored);
    this.histories.set(projectId, frozen);
    return frozen;
  }

  private append(
    projectId: ProjectId,
    sender: MailboxParticipant,
    recipient: MailboxParticipant,
    body: string,
  ): ProjectMessage {
    this.requireBody(body);
    this.requireRoute(projectId, sender, recipient);

    const history = this.getHistory(projectId);
    const message = this.freezeMessage({
      version: 1,
      id: createMessageId(randomUUID()),
      projectId,
      sequence: history.length + 1,
      timestamp: new Date().toISOString(),
      sender,
      recipient,
      body,
    });
    this.histories.set(projectId, Object.freeze([...history, message]));
    return message;
  }

  private parseMessage(projectId: ProjectId, raw: unknown, expectedSequence: number): ProjectMessage {
    if (!raw || typeof raw !== "object") {
      throw new MailboxError("invalid-history", "Mailbox history contains an invalid message.");
    }

    const value = raw as Record<string, unknown>;
    if (
      value.version !== 1
      || typeof value.id !== "string"
      || value.projectId !== projectId
      || value.sequence !== expectedSequence
      || typeof value.timestamp !== "string"
      || Number.isNaN(Date.parse(value.timestamp))
      || typeof value.body !== "string"
    ) {
      throw new MailboxError("invalid-history", "Mailbox history contains an invalid message envelope.");
    }

    this.requireBody(value.body);
    const sender = this.parseParticipant(value.sender);
    const recipient = this.parseParticipant(value.recipient);
    this.requireRoute(projectId, sender, recipient);

    return this.freezeMessage({
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

  private parseParticipant(value: unknown): MailboxParticipant {
    if (!value || typeof value !== "object") {
      throw new MailboxError("invalid-history", "Mailbox participant is invalid.");
    }
    const participant = value as Record<string, unknown>;
    if (participant.kind === "main") return Object.freeze({ kind: "main" });
    if (participant.kind === "node" && typeof participant.nodeId === "string") {
      return Object.freeze({ kind: "node", nodeId: createNodeId(participant.nodeId) });
    }
    throw new MailboxError("invalid-history", "Mailbox participant is invalid.");
  }

  private requireRoute(
    projectId: ProjectId,
    sender: MailboxParticipant,
    recipient: MailboxParticipant,
  ): void {
    const nodeToMain = sender.kind === "node" && recipient.kind === "main";
    const mainToNode = sender.kind === "main" && recipient.kind === "node";
    if (!nodeToMain && !mainToNode) {
      throw new MailboxError("invalid-route", "Mailbox only supports Node-to-Main and Main-to-Node routes.");
    }

    if (sender.kind === "node") this.requireWorkNode(projectId, sender.nodeId);
    if (recipient.kind === "node") this.requireWorkNode(projectId, recipient.nodeId);
  }

  private requireActiveProject(projectId: ProjectId): void {
    if (this.ctx.projects.get(projectId)?.status !== "active") {
      throw new MailboxError("project-unavailable", "Mailbox posts require an active Project.");
    }
  }

  private requireWorkNode(projectId: ProjectId, nodeId: NodeId): void {
    const node = this.ctx.nodes.get(nodeId);
    if (!node || node.node.projectId !== projectId || node.node.kind !== "work") {
      throw new MailboxError("node-unavailable", "Mailbox Node must be a work Node in the same Project.");
    }
  }

  private requireBody(body: string): void {
    if (body.trim().length === 0) {
      throw new MailboxError("invalid-message", "Mailbox message body must be non-empty.");
    }
  }

  private freezeMessage(message: ProjectMessage): ProjectMessage {
    const sender = Object.freeze({ ...message.sender }) as MailboxParticipant;
    const recipient = Object.freeze({ ...message.recipient }) as MailboxParticipant;
    return Object.freeze({ ...message, sender, recipient });
  }
}

declare module "cordis" {
  interface Context {
    mailbox: MailboxStore;
  }
}
