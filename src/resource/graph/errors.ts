export class GraphError extends Error {
  constructor(readonly code: "invalid-output" | "output-limit" | "input-limit" | "model-failed" | "cancelled" | "source-changed",
    message: string) {
    super(message);
    this.name = "GraphError";
  }
}
