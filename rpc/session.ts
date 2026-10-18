import type { RpcMethod, RpcOutputValidator } from "./protocol.js";
import { RpcError } from "./errors.js";
import {
  parseSessionContextFollowEvent,
  parseSessionContextFollowInput,
  parseSessionContextInput,
  parseSessionContextSnapshot,
  parseSessionHistory,
  parseSessionHistoryInput,
} from "./session/validation.js";

export const SESSION_HISTORY_PAGE_MAX = 50;

export type SessionFailureCode =
  | "session-context-unavailable"
  | "history-changed"
  | "internal";

export interface SessionContextInputV1 {
  readonly sessionId: string;
}

export interface SessionContextSnapshotV1 {
  readonly sessionId: string;
  readonly eventSequence: number;
  readonly surfaceGeneration: number;
  readonly measuredAt: string;
  readonly measurement: SessionContextMeasurementV1;
  readonly budget: SessionContextBudgetV1;
}

export interface SessionContextMeasurementV1 {
  readonly usedTokens: number;
  readonly estimatedRequestTokens: number;
  readonly basis: "usage" | "estimate";
}

export type SessionContextBudgetV1 =
  | {
      readonly kind: "enabled";
      readonly contextWindow?: number;
      readonly reservedOutputTokens: number;
      readonly thresholdTokens: number;
      readonly retainTokens: number;
      readonly exceeded: boolean;
    }
  | {
      readonly kind: "disabled";
      readonly reason: "missing-capacity" | "no-pressure-budget";
    };

export interface SessionContextFollowInputV1 {
  readonly sessionId: string;
}

export type SessionContextFollowEventV1 =
  | { readonly type: "snapshot"; readonly snapshot: SessionContextSnapshotV1 }
  | { readonly type: "context-updated"; readonly snapshot: SessionContextSnapshotV1 }
  | { readonly type: "compaction-event"; readonly event: SessionCompactionEventV1 };

export type SessionCompactionEventV1 =
  | {
      readonly kind: "started";
      readonly sessionId: string;
      readonly sequence: number;
      readonly timestamp: string;
      readonly compactionId: string;
      readonly trigger: "pressure" | "overflow" | "manual";
      readonly coveredStart: number;
      readonly coveredEnd: number;
      readonly turnId?: string;
    }
  | {
      readonly kind: "checkpoint";
      readonly sessionId: string;
      readonly sequence: number;
      readonly timestamp: string;
      readonly compactionId: string;
      readonly coveredStart: number;
      readonly coveredEnd: number;
      readonly summaryVersion: 1;
      readonly surfaceGeneration: number;
    }
  | {
      readonly kind: "ended";
      readonly sessionId: string;
      readonly sequence: number;
      readonly timestamp: string;
      readonly compactionId: string;
      readonly status: "completed" | "failed" | "cancelled" | "interrupted";
      readonly beforeTokens?: number;
      readonly afterTokens?: number;
      readonly summaryTokens?: number;
      readonly provider?: string;
      readonly model?: string;
      readonly failure?: { readonly code: string; readonly message: string };
    };

export interface SessionHistoryInputV1 {
  readonly sessionId: string;
  readonly limit: number;
  readonly cursor?: SessionHistoryCursorV1;
}

export interface SessionHistoryCursorV1 {
  readonly surfaceGeneration: number;
  readonly offset: number;
}

export type SessionHistoryEntryV1 =
  | {
      readonly kind: "message";
      readonly sequence: number;
      readonly timestamp: string;
      readonly message: SessionHistoryMessageV1;
    }
  | {
      readonly kind: "summary-checkpoint";
      readonly sequence: number;
      readonly timestamp: string;
      readonly message: SessionHistoryMessageV1;
      readonly compactionId: string;
      readonly coveredStart: number;
      readonly coveredEnd: number;
      readonly summaryVersion: 1;
    };

export interface SessionHistoryV1 {
  readonly sessionId: string;
  readonly surfaceGeneration: number;
  readonly entries: readonly SessionHistoryEntryV1[];
  readonly nextCursor: SessionHistoryCursorV1 | null;
}

export interface SessionHistoryMessageV1 {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: readonly SessionHistoryContentV1[];
}

export type SessionHistoryContentV1 =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "reasoning"; readonly text: string }
  | {
      readonly type: "tool-call";
      readonly id: string;
      readonly name: string;
      readonly arguments: string;
    }
  | {
      readonly type: "tool-result";
      readonly toolCallId: string;
      readonly content: readonly SessionHistoryContentV1[];
      readonly isError: boolean;
    };

export const sessionContextMethod: RpcMethod<SessionContextInputV1, SessionContextSnapshotV1> = Object.freeze({
  name: "session.context.v1",
  parseInput: parseSessionContextInput,
  parseOutput: parseSessionContextSnapshot,
  createOutputValidator: () => singleOutput(parseSessionContextSnapshot),
});

export const sessionContextFollowMethod: RpcMethod<
  SessionContextFollowInputV1,
  SessionContextFollowEventV1
> = Object.freeze({
  name: "session.context.follow.v1",
  parseInput: parseSessionContextFollowInput,
  parseOutput: parseSessionContextFollowEvent,
  createOutputValidator: createFollowOutputValidator,
});

export const sessionHistoryMethod: RpcMethod<SessionHistoryInputV1, SessionHistoryV1> = Object.freeze({
  name: "session.history.v1",
  parseInput: parseSessionHistoryInput,
  parseOutput: parseSessionHistory,
  createOutputValidator: () => singleOutput(parseSessionHistory),
});

function createFollowOutputValidator(
  input: SessionContextFollowInputV1,
): RpcOutputValidator<SessionContextFollowEventV1> {
  let received = false;
  return {
    parse(value: unknown): SessionContextFollowEventV1 {
      const frame = parseSessionContextFollowEvent(value);
      if (!received && frame.type !== "snapshot") {
        throw new RpcError("invalid-output", "Session context follow must start with a snapshot");
      }
      received = true;
      if (frame.type === "compaction-event") {
        if (frame.event.sessionId !== input.sessionId) {
          throw new RpcError("invalid-output", "Session context follow leaked another Session");
        }
      } else if (frame.snapshot.sessionId !== input.sessionId) {
        throw new RpcError("invalid-output", "Session context follow leaked another Session");
      }
      return frame;
    },
    end(): void {
      if (!received) throw new RpcError("invalid-output", "Session context follow ended before its snapshot");
    },
  };
}

function singleOutput<T>(parse: (value: unknown) => T): RpcOutputValidator<T> {
  let received = false;
  return {
    parse(value: unknown): T {
      if (received) throw new RpcError("invalid-output", "Session method returns exactly one result");
      received = true;
      return parse(value);
    },
    end(): void {
      if (!received) throw new RpcError("invalid-output", "Session method ended without a result");
    },
  };
}
