import { RpcError } from "../errors.js";
import type { RpcMethod, RpcOutputValidator } from "../protocol.js";
import { parseProjectSessionRecovery, parseProjectSessionRecoveryInput } from "./session/validation.js";

export const projectSessionRecoveryMethod: RpcMethod<
  ProjectSessionRecoveryInputV1,
  ProjectSessionRecoveryV1
> = Object.freeze({
  name: "project.session.recovery.v1",
  parseInput: parseProjectSessionRecoveryInput,
  parseOutput: parseProjectSessionRecovery,
  createOutputValidator: () => singleOutput(parseProjectSessionRecovery),
});

export interface ProjectSessionRecoveryInputV1 {
  readonly projectId: string;
}

export interface ProjectSessionRecoveryV1 {
  readonly projectId: string;
  readonly sessions: readonly ProjectSessionRecoveryEntryV1[];
}

export type ProjectSessionRecoveryEntryV1 =
  | {
      readonly owner: ProjectSessionOwnerV1;
      readonly status: "unestablished";
    }
  | {
      readonly owner: ProjectSessionOwnerV1;
      readonly status: "available";
      readonly sessionId: string;
      readonly lastEndedTurn: ProjectSessionTurnV1 | null;
    }
  | {
      readonly owner: ProjectSessionOwnerV1;
      readonly status: "unavailable";
      readonly sessionId: string;
      readonly reason: "not-readable";
    };

export type ProjectSessionOwnerV1 =
  | { readonly kind: "main" }
  | { readonly kind: "node"; readonly nodeId: string };

export interface ProjectSessionTurnV1 {
  readonly turnId: string;
  readonly status: "completed" | "blocked" | "cancelled" | "failed";
  readonly startedAt: string;
  readonly endedAt: string;
  readonly interruption: "host-stopped" | "context-compaction" | null;
}

function singleOutput<T>(parse: (value: unknown) => T): RpcOutputValidator<T> {
  let received = false;
  return {
    parse(value) {
      if (received) throw new RpcError("invalid-output", "Project session method returns exactly one item");
      received = true;
      return parse(value);
    },
    end() {
      if (!received) throw new RpcError("invalid-output", "Project session method ended without a result");
    },
  };
}
