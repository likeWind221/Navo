import { projectCreateMethod, projectGetMethod, projectListMethod } from "../../../../rpc/project.js";
import type { ProjectDetailV1, ProjectListV1, ProjectSummaryV1 } from "../../../../rpc/project.js";
import { RpcError } from "../../../../rpc/errors.js";
import type { RpcMethod, RpcStreamOptions } from "../../../../rpc/index.js";
import type { DesktopProjectFailure, DesktopProjectResult } from "../../../shared/project.js";
import {
  DESKTOP_PROJECT_FAILURE_MESSAGE_MAX_CHARS,
  isProjectFailureCode,
} from "../../../shared/project/validation.js";

export interface ProjectHost {
  stream<TInput, TOutput>(
    method: RpcMethod<TInput, TOutput>,
    input: TInput,
    options?: RpcStreamOptions,
  ): AsyncIterable<TOutput>;
}

export interface ProjectHandlers {
  list(candidate: unknown): Promise<DesktopProjectResult<ProjectListV1>>;
  create(candidate: unknown): Promise<DesktopProjectResult<ProjectSummaryV1>>;
  get(candidate: unknown): Promise<DesktopProjectResult<ProjectDetailV1>>;
}

export interface DirectoryDialogResult {
  readonly canceled: boolean;
  readonly filePaths: readonly string[];
}

export function createProjectHandlers(host: ProjectHost): ProjectHandlers {
  return {
    list: candidate => callProject(host, projectListMethod, candidate),
    create: candidate => callProject(host, projectCreateMethod, candidate),
    get: candidate => callProject(host, projectGetMethod, candidate),
  };
}

export async function chooseWorkspace(
  open: () => Promise<DirectoryDialogResult>,
): Promise<DesktopProjectResult<string | null>> {
  const result = await open();
  return { type: "ok", value: result.canceled ? null : result.filePaths[0] ?? null };
}

async function callProject<TInput, TOutput>(
  host: ProjectHost,
  method: RpcMethod<TInput, TOutput>,
  candidate: unknown,
): Promise<DesktopProjectResult<TOutput>> {
  let input: TInput;
  try {
    input = method.parseInput(candidate);
  } catch {
    return failed({ code: "invalid-input", message: "The project request is invalid" });
  }
  try {
    const outputs: TOutput[] = [];
    for await (const output of host.stream(method, input)) outputs.push(output);
    const [value] = outputs;
    if (outputs.length !== 1 || value === undefined) {
      return failed({ code: "invalid-output", message: "Project method must return exactly one result" });
    }
    return { type: "ok", value };
  } catch (error: unknown) {
    return failed(toProjectFailure(error));
  }
}

function toProjectFailure(error: unknown): DesktopProjectFailure {
  if (!(error instanceof RpcError)) return { code: "host-unavailable", message: "Kernel Host is unavailable" };
  switch (error.code) {
    case "remote-error": {
      const remote = error.failure;
      if (remote !== undefined && isProjectFailureCode(remote.code)) {
        return { code: remote.code, message: bounded(remote.message) };
      }
      return { code: "internal", message: bounded(`${remote?.code ?? "remote-error"}: ${error.message}`) };
    }
    case "invalid-output":
    case "invalid-frame":
      return { code: "invalid-output", message: "Kernel Host returned a malformed project result" };
    case "invalid-input":
      return { code: "invalid-input", message: "The project request is invalid" };
    case "cancelled":
    case "connection-closed":
    case "duplicate-request":
    case "method-not-found":
      return { code: "host-unavailable", message: `Kernel Host is unavailable (${error.code})` };
  }
}

function bounded(message: string): string {
  const text = message.trim() || "Project request failed";
  return text.length > DESKTOP_PROJECT_FAILURE_MESSAGE_MAX_CHARS
    ? text.slice(0, DESKTOP_PROJECT_FAILURE_MESSAGE_MAX_CHARS)
    : text;
}

function failed<T>(failure: DesktopProjectFailure): DesktopProjectResult<T> {
  return { type: "failed", failure };
}
