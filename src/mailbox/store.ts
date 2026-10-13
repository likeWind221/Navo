import { randomUUID } from "node:crypto";
import { Service } from "cordis";
import type { Context } from "cordis";
import { createMessageId, createProjectId } from "../brand/ids.js";
import type { NodeId, ProjectId } from "../brand/ids.js";
import { StorageError } from "../storage/errors.js";
import { MailboxError } from "./errors.js";
import { parseMailboxHistory } from "./history.js";
import type {
  MailboxParticipant,
  PostFromMainInput,
  PostFromNodeInput,
  ProjectMessage,
} from "./model.js";

const emptyHistory: readonly ProjectMessage[] = Object.freeze([]);

export class MailboxStore extends Service {
  static inject = ["storage", "projects", "nodes"];

  private readonly histories = new Map<ProjectId, readonly ProjectMessage[]>();

  constructor(ctx: Context) {
    super(ctx, "mailbox");
    for (const [projectId, stored] of ctx.storage.recovery.events.get("mailbox")!) {
      try {
        if (stored.projectId !== projectId) throw new MailboxError("invalid-history", "Mailbox Project does not match its storage owner.");
        this.restore(createProjectId(projectId), stored.events);
      } catch (error: unknown) {
        throw new StorageError("invalid-record", `Stored mailbox history ${projectId} is invalid.`, { cause: error });
      }
    }
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

    const restored = parseMailboxHistory(projectId, history, this.ctx.projects, new Map(
      this.ctx.nodes.getByProject(projectId).map(node => [node.node.id, node]),
    ));

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
    this.ctx.storage.write(tx => {
      tx.appendEvents({ domain: "mailbox", ownerId: projectId, projectId, firstSeq: message.sequence, events: [message] });
    }, () => {
      this.histories.set(projectId, Object.freeze([...history, message]));
      this.ctx.emit("project/changed", projectId);
    });
    return message;
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
