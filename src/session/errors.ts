export class SessionError extends Error {
  constructor(readonly code: "invalid-history", message: string) {
    super(message);
    this.name = "SessionError";
  }
}
