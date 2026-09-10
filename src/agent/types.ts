import type { SessionId, TurnId } from "../brand/ids.js";
import type { TurnEvent } from "../../shared/content.js";
import type { TurnOutput } from "./output.js";
import type {
  AssistantMessage,
  FinishReason,
  TokenUsage,
  UserMessage,
} from "../llm/types.js";
import type { Failure, TurnEndStatus } from "../session/types.js";
export type { TurnEvent } from "../../shared/content.js";

export interface RunTurnInput {
  readonly sessionId: SessionId;
  readonly requestId?: string;
  readonly userMessage: UserMessage;
  readonly model: TurnModelConfig;
  readonly systemPrompt?: string;
  readonly toolNames?: readonly string[];
  readonly signal?: AbortSignal;
  readonly limits?: Partial<AgentRuntimeLimits>;
  readonly onEvent?: (event: TurnEvent) => boolean | void | Promise<boolean | void>;
}

export type ResolvedRunTurnInput = Omit<RunTurnInput, "toolNames"> & {
  readonly toolNames: readonly string[];
};


export type TurnResult =
  | CompletedTurnResult
  | BlockedTurnResult
  | CancelledTurnResult
  | FailedTurnResult;

export interface TurnModelConfig {
  readonly provider: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface AgentRuntimeLimits {
  readonly maxSteps: number;
  readonly modelTimeoutMs: number;
  readonly maxModelRetries: number;
}

export interface TurnScope {
  readonly input: ResolvedRunTurnInput;
  readonly output: TurnOutput;
  readonly turnId: TurnId;
  readonly signal: AbortSignal;
  readonly limits: AgentRuntimeLimits;
}

export interface ModelCompletion {
  readonly message: AssistantMessage;
  readonly finishReason: FinishReason;
  readonly usage?: TokenUsage;
}

export interface CompletedTurnResult {
  readonly status: "completed";
  readonly turnId: TurnId;
  readonly steps: number;
}

export interface BlockedTurnResult {
  readonly status: "blocked";
  readonly turnId: TurnId;
  readonly steps: number;
  readonly failure: Failure;
}

export interface CancelledTurnResult {
  readonly status: "cancelled";
  readonly turnId: TurnId;
  readonly steps: number;
}

export interface FailedTurnResult {
  readonly status: "failed";
  readonly turnId: TurnId;
  readonly steps: number;
  readonly failure: Failure;
}

export type AgentRuntimeTurnStatus = TurnEndStatus;
