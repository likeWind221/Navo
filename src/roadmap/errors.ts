export class RoadmapError extends Error {
  constructor(
    public readonly code:
      | "invalid-structure"
      | "invalid-reference"
      | "duplicate-reference"
      | "cycle"
      | "not-found"
      | "already-exists"
      | "stale-revision"
      | "project-unavailable"
      | "working-node"
      | "invalid-event-stream",
    message: string,
  ) {
    super(message);
    this.name = "RoadmapError";
  }
}
