import type { DesktopAgentFailure } from "../agent.js";

export class DesktopAgentCommandError extends Error {
  constructor(readonly failure: DesktopAgentFailure) {
    super(failure.message);
    this.name = "DesktopAgentCommandError";
  }
}

