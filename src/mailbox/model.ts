import type { MessageId, NodeId, ProjectId } from "../brand/ids.js";

export type MailboxParticipant =
  | { readonly kind: "main" }
  | { readonly kind: "node"; readonly nodeId: NodeId };

export interface ProjectMessage {
  readonly version: 1;
  readonly id: MessageId;
  readonly projectId: ProjectId;
  readonly sequence: number;
  readonly timestamp: string;
  readonly sender: MailboxParticipant;
  readonly recipient: MailboxParticipant;
  readonly body: string;
}

export interface PostFromNodeInput {
  readonly projectId: ProjectId;
  readonly nodeId: NodeId;
  readonly body: string;
}

export interface PostFromMainInput {
  readonly projectId: ProjectId;
  readonly nodeId: NodeId;
  readonly body: string;
}
