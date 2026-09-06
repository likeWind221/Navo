/** Stable rejection categories exposed by the Node domain. */
export type NodeErrorCode =
  | "node-not-found"
  | "node-already-bound"
  | "session-already-bound"
  | "node-session-required"
  | "invalid-content"
  | "invalid-message"
  | "node-session-service-unavailable"
  | "invalid-event-stream";

/** A rejected Node command or an invalid committed Node history. */
export class NodeError extends Error {
  readonly code: NodeErrorCode;

  constructor(code: NodeErrorCode, message: string) {
    super(message);
    this.name = "NodeError";
    this.code = code;
  }
}
