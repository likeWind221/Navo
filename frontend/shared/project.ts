import type {
  ProjectCreateInput,
  ProjectDetailV1,
  ProjectFailureCode,
  ProjectListV1,
  ProjectRefInput,
  ProjectSummaryV1,
} from "../../rpc/project.js";

export interface DesktopProjectApi {
  list(): Promise<DesktopProjectResult<ProjectListV1>>;
  create(input: ProjectCreateInput): Promise<DesktopProjectResult<ProjectSummaryV1>>;
  get(input: ProjectRefInput): Promise<DesktopProjectResult<ProjectDetailV1>>;
  chooseWorkspace(): Promise<DesktopProjectResult<string | null>>;
}

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

export type DesktopBridgeFailureCode = "host-unavailable" | "invalid-input" | "invalid-output" | "bridge-closed";
