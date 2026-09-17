export class MailboxError extends Error {
  constructor(readonly code: MailboxErrorCode, message: string) {
    super(message);
    this.name = "MailboxError";
  }
}

export type MailboxErrorCode =
  | "project-unavailable"
  | "node-unavailable"
  | "invalid-route"
  | "invalid-message"
  | "invalid-history"
  | "mailbox-already-restored";
