export class NodeError extends Error {
  constructor(readonly code: NodeErrorCode, message: string) {
    super(message);
    this.name = "NodeError";
  }
}

export type NodeErrorCode =
  | "node-not-found"
  | "node-already-bound"
  | "session-already-bound"
  | "node-session-required"
  | "project-unavailable"
  | "invalid-state"
  | "stale-revision"
  | "invalid-message"
  | "node-session-service-unavailable"
  | "node-context-unavailable"
  | "invalid-event-stream";
