export class SessionError extends Error {
  constructor(readonly code: "invalid-history" | "session-unavailable" | "persistence-unavailable", message: string) {
    super(message);
    this.name = "SessionError";
  }
}
