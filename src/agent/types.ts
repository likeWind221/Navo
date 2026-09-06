import type { SessionId, TurnId } from "../brand/ids.js";
import type {
  AssistantMessage,
  FinishReason,
  TokenUsage,
  UserMessage,
} from "../llm/types.js";
import type { Failure, TurnEndStatus } from "../session/types.js";

/** Public input for one self-contained model-and-tool turn. */
export interface RunTurnInput {
  readonly sessionId: SessionId;
  readonly userMessage: UserMessage;
  readonly model: TurnModelConfig;
  /** Model-visible Turn prefix, recorded in every resulting request snapshot. */
  readonly systemPrompt?: string;
  /** Exact registered tools visible and executable during this Turn; absent means all. */
  readonly toolNames?: readonly string[];
  /** Cooperative cancellation for the entire turn; never persisted. */
  readonly signal?: AbortSignal;
  /** Per-turn overrides to the runtime's configured safety limits. */
  readonly limits?: Partial<AgentRuntimeLimits>;
  /** Ordered live observations for trusted in-process consumers; never persisted. */
  readonly observer?: AgentTurnObserver;
}

/** A deliberately small live surface that excludes reasoning and tool internals. */
export interface AgentTurnObserver {
  onStarted(turnId: TurnId): void | Promise<void>;
  onTextDelta(text: string): void | Promise<void>;
}

/** Terminal outcome of one requested turn. */
export type TurnResult =
  | CompletedTurnResult
  | BlockedTurnResult
  | CancelledTurnResult
  | FailedTurnResult;

/** Model route and optional sampling controls owned by a caller. */
export interface TurnModelConfig {
  readonly provider: string;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

/** Validated safety limits applied by the runtime to one Turn. */
export interface AgentRuntimeLimits {
  /** Maximum number of Steps that may start in one Turn. */
  readonly maxSteps: number;
  /** Total elapsed deadline for each model request attempt. */
  readonly modelTimeoutMs: number;
  /** Additional attempts after the first request for transient model failures. */
  readonly maxModelRetries: number;
}

/** Internal immutable facts shared by one Turn's execution modules. */
export interface TurnScope {
  readonly input: RunTurnInput;
  readonly turnId: TurnId;
  readonly signal: AbortSignal;
  readonly limits: AgentRuntimeLimits;
}

/** One accepted model response before Session and tool processing. */
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

/** The runtime stopped cleanly because it needs an explicit caller decision. */
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

/** Keeps the runtime protocol tied to the durable Session terminal vocabulary. */
export type AgentRuntimeTurnStatus = TurnEndStatus;
