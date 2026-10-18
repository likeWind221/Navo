import type { JsonValue } from "../../rpc/protocol.js";
import type {
  SessionContextFollowEventV1,
  SessionContextFollowInputV1,
  SessionContextInputV1,
  SessionContextSnapshotV1,
  SessionFailureCode,
  SessionHistoryInputV1,
  SessionHistoryV1,
} from "../../rpc/session.js";

export interface DesktopSessionApi {
  getContext(input: SessionContextInputV1): Promise<DesktopSessionResult<SessionContextSnapshotV1>>;
  getHistory(input: SessionHistoryInputV1): Promise<DesktopSessionResult<SessionHistoryV1>>;
  startContextFollow(
    input: SessionContextFollowInputV1,
  ): Promise<DesktopSessionResult<DesktopSessionFollowHandle>>;
  cancelContextFollow(subscriptionId: string): Promise<DesktopSessionResult<null>>;
  onContextEvent(listener: DesktopSessionEventListener): () => void;
}

export interface DesktopSessionFollowHandle {
  readonly subscriptionId: string;
}

export type DesktopSessionResult<T> = DesktopSessionSuccess<T> | DesktopSessionFailed;

export interface DesktopSessionSuccess<T> {
  readonly type: "ok";
  readonly value: T;
}

export interface DesktopSessionFailed {
  readonly type: "failed";
  readonly failure: DesktopSessionFailure;
}

export interface DesktopSessionFailure {
  readonly code: DesktopSessionFailureCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, JsonValue>>;
}

export type DesktopSessionFailureCode =
  | SessionFailureCode
  | "invalid-input"
  | "invalid-output"
  | "host-unavailable"
  | "bridge-closed";

export type DesktopSessionEventListener = (event: DesktopSessionEvent) => void;

export type DesktopSessionEvent = DesktopSessionContextEvent | DesktopSessionFollowError;

export interface DesktopSessionContextEvent {
  readonly type: "context-event";
  readonly subscriptionId: string;
  readonly event: SessionContextFollowEventV1;
}

export interface DesktopSessionFollowError {
  readonly type: "context-follow-error";
  readonly subscriptionId: string;
  readonly failure: DesktopSessionFailure;
}
