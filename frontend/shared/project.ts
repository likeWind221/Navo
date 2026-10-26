import type {
  AutoRunSnapshotV1,
  ProjectCreateInput,
  ProjectDetailV1,
  ProjectFailureCode,
  ProjectListV1,
  ProjectRefInput,
  ProjectSummaryV1,
  ProjectFollowV1,
  ProjectTurnInput,
} from "../../rpc/project.js";
import type { AgentTurnV2Event } from "../../rpc/content.js";

export interface DesktopProjectApi {
  list(): Promise<DesktopProjectResult<ProjectListV1>>;
  create(input: ProjectCreateInput): Promise<DesktopProjectResult<ProjectSummaryV1>>;
  get(input: ProjectRefInput): Promise<DesktopProjectResult<ProjectDetailV1>>;
  autoRunStart(input: ProjectRefInput): Promise<DesktopProjectResult<AutoRunSnapshotV1>>;
  autoRunPause(input: ProjectRefInput): Promise<DesktopProjectResult<AutoRunSnapshotV1>>;
  autoRunResume(input: ProjectRefInput): Promise<DesktopProjectResult<AutoRunSnapshotV1>>;
  autoRunGet(input: ProjectRefInput): Promise<DesktopProjectResult<AutoRunSnapshotV1 | null>>;
  chooseWorkspace(): Promise<DesktopProjectResult<string | null>>;
  startTurn(input: ProjectTurnInput): Promise<DesktopProjectResult<DesktopProjectStreamHandle>>;
  cancel(operationId: string): Promise<DesktopProjectResult<null>>;
  startFollow(input: ProjectRefInput): Promise<DesktopProjectResult<DesktopProjectStreamHandle>>;
  onEvent(listener: DesktopProjectEventListener): () => void;
}

export interface DesktopProjectStreamHandle { readonly subscriptionId: string; }
export type DesktopProjectEventListener = (event: DesktopProjectEvent) => void;
export type DesktopProjectEvent =
  | { readonly type: "turn-event"; readonly operationId: string; readonly projectId: string; readonly event: AgentTurnV2Event }
  | { readonly type: "turn-error"; readonly operationId: string; readonly projectId: string; readonly failure: DesktopProjectFailure }
  | { readonly type: "follow-snapshot"; readonly operationId: string; readonly projectId: string; readonly snapshot: ProjectFollowV1 }
  | { readonly type: "follow-error"; readonly operationId: string; readonly projectId: string; readonly failure: DesktopProjectFailure };

export type DesktopProjectResult<T> = DesktopProjectSuccess<T> | DesktopProjectFailed;

export interface DesktopProjectSuccess<T> {
  readonly type: "ok";
  readonly value: T;
}

export interface DesktopProjectFailed {
  readonly type: "failed";
  readonly failure: DesktopProjectFailure;
}

export interface DesktopProjectFailure {
  readonly code: DesktopProjectFailureCode;
  readonly message: string;
}

export type DesktopProjectFailureCode = ProjectFailureCode | DesktopBridgeFailureCode;

export type DesktopBridgeFailureCode = "cancelled" | "host-unavailable" | "invalid-input" | "invalid-output" | "bridge-closed";
