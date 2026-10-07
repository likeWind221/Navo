import type { AgentTurnV2Event } from "../content.js";
import { createTurnOutputValidator } from "../content/stream.js";
import { RpcError } from "../errors.js";
import type { RpcOutputValidator } from "../protocol.js";
import type { ProjectTurnInput } from "../project.js";
import { requireBoundedString, requireRecord } from "../validation.js";

export function createProjectTurnOutputValidator(input: ProjectTurnInput): RpcOutputValidator<AgentTurnV2Event> {
  let inner: RpcOutputValidator<AgentTurnV2Event> | undefined;
  return {
    parse(value: unknown): AgentTurnV2Event {
      if (inner === undefined) {
        const sessionId = requireBoundedString(requireRecord(value, "turn event").sessionId, "sessionId", 128);
        inner = createTurnOutputValidator({ sessionId, requestId: input.requestId, text: input.text });
      }
      return inner.parse(value);
    },
    end(): void {
      if (inner === undefined) throw new RpcError("invalid-output", "Project turn ended without events");
      inner.end();
    },
  };
}
