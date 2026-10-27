import { randomUUID } from "node:crypto";
import { RpcError } from "../../../../rpc/errors.js";
import { projectFollowMethod, projectTurnMethod } from "../../../../rpc/project.js";
import type { ProjectFollowV1, ProjectRefInput, ProjectTurnInput } from "../../../../rpc/project.js";
import type { RpcMethod, RpcStreamOptions } from "../../../../rpc/index.js";
import type { AgentTurnV2Event } from "../../../../rpc/content.js";
import type { DesktopProjectEvent, DesktopProjectFailure, DesktopProjectResult, DesktopProjectStreamHandle } from "../../../shared/project.js";
import { isProjectFailureCode } from "../../../shared/project/validation.js";
import type { ProjectHost } from "./handler.js";

export interface ProjectTarget {
  readonly ownerId: number;
  isDestroyed(): boolean;
  send(event: DesktopProjectEvent): void;
}

interface ActiveOperation {
  readonly id: string;
  readonly projectId: string;
  readonly target: ProjectTarget;
  readonly controller: AbortController;
  readonly kind: "turn" | "follow";
  readonly requestId?: string;
  sessionId?: string;
  cancelled: boolean;
  turnId?: string;
}

export class ProjectController {
  private readonly operations = new Map<string, ActiveOperation>();
  private disposed = false;

  constructor(private readonly host: ProjectHost) {}

  startTurn(target: ProjectTarget, candidate: unknown): DesktopProjectResult<DesktopProjectStreamHandle> {
    return this.start(target, "turn", projectTurnMethod, candidate);
  }

  startFollow(target: ProjectTarget, candidate: unknown): DesktopProjectResult<DesktopProjectStreamHandle> {
    return this.start(target, "follow", projectFollowMethod, candidate);
  }

  cancel(ownerId: number, candidate: string): DesktopProjectResult<null> {
    const operation = this.operations.get(candidate);
    if (operation?.target.ownerId === ownerId) this.cancelOperation(operation, true);
    return { type: "ok", value: null };
  }

  cancelOwner(ownerId: number): void {
    for (const operation of [...this.operations.values()]) {
      if (operation.target.ownerId === ownerId) this.cancelOperation(operation, false);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const operation of [...this.operations.values()]) this.cancelOperation(operation, false);
  }

  private start<TInput, TOutput>(target: ProjectTarget, kind: ActiveOperation["kind"], method: RpcMethod<TInput, TOutput>, candidate: unknown): DesktopProjectResult<DesktopProjectStreamHandle> {
    if (this.disposed) return failed("bridge-closed", "Project bridge is closed");
    let input: TInput;
    try { input = method.parseInput(candidate); } catch { return failed("invalid-input", "The project request is invalid"); }
    const value = input as ProjectTurnInput | ProjectRefInput;
    const turnInput = kind === "turn" ? value as ProjectTurnInput : undefined;
    const operation: ActiveOperation = { id: randomUUID(), projectId: value.projectId, target, controller: new AbortController(), kind, cancelled: false,
      ...(turnInput === undefined ? {} : { requestId: turnInput.requestId }) };
    this.operations.set(operation.id, operation);
    void this.run(operation, method, input);
    return { type: "ok", value: { subscriptionId: operation.id } };
  }

  private async run<TInput, TOutput>(operation: ActiveOperation, method: RpcMethod<TInput, TOutput>, input: TInput): Promise<void> {
    try {
      let received = false;
      let terminal = false;
      for await (const candidate of this.host.stream(method, input, { signal: operation.controller.signal })) {
        received = true;
        const output = method.parseOutput(candidate);
        if (operation.kind === "turn") {
          const event = output as AgentTurnV2Event;
          if (event.type === "turn-started") { operation.turnId = event.turnId; operation.sessionId = event.sessionId; }
          this.publish(operation, { type: "turn-event", operationId: operation.id, projectId: operation.projectId, event });
          if (isTerminal(event)) { terminal = true; break; }
        } else {
          const snapshot = output as ProjectFollowV1;
          if (snapshot.detail.project.projectId !== operation.projectId) throw new RpcError("invalid-output", "Project follow crossed its requested scope");
          this.publish(operation, { type: "follow-snapshot", operationId: operation.id, projectId: operation.projectId, snapshot });
        }
      }
      if (!operation.cancelled && operation.kind === "turn" && !terminal) {
        this.publish(operation, { type: "turn-error", operationId: operation.id, projectId: operation.projectId, failure: failure("invalid-output", "Project turn ended without a terminal event") });
      }
      if (!operation.cancelled && operation.kind === "follow") {
        this.publish(operation, { type: "follow-error", operationId: operation.id, projectId: operation.projectId, failure: failure("host-unavailable", received ? "Project follow ended" : "Project follow returned no baseline") });
      }
    } catch (error: unknown) {
      if (!operation.cancelled && !this.disposed) {
        const failureValue = toFailure(error);
        this.publish(operation, operation.kind === "turn"
          ? { type: "turn-error", operationId: operation.id, projectId: operation.projectId, failure: failureValue }
          : { type: "follow-error", operationId: operation.id, projectId: operation.projectId, failure: failureValue });
      }
    } finally {
      if (this.operations.get(operation.id) === operation) this.operations.delete(operation.id);
    }
  }

  private cancelOperation(operation: ActiveOperation, notify: boolean): void {
    if (this.operations.get(operation.id) !== operation) return;
    this.operations.delete(operation.id);
    operation.cancelled = true;
    operation.controller.abort("Project operation was cancelled");
    if (notify && operation.kind === "turn" && !operation.target.isDestroyed()) {
      if (operation.turnId !== undefined && operation.sessionId !== undefined && operation.requestId !== undefined) {
        operation.target.send({ type: "turn-event", operationId: operation.id, projectId: operation.projectId, event: { type: "turn-cancelled", sessionId: operation.sessionId, requestId: operation.requestId, turnId: operation.turnId } });
      } else {
        operation.target.send({ type: "turn-error", operationId: operation.id, projectId: operation.projectId, failure: failure("cancelled", "Project turn was cancelled") });
      }
    }
  }

  private publish(operation: ActiveOperation, event: DesktopProjectEvent): void {
    if (this.operations.get(operation.id) !== operation || operation.target.isDestroyed()) return;
    operation.target.send(event);
  }
}

function isTerminal(event: AgentTurnV2Event): boolean {
  return event.type === "turn-completed" || event.type === "turn-cancelled" || event.type === "turn-failed" || event.type === "turn-truncated";
}

function toFailure(error: unknown): DesktopProjectFailure {
  if (!(error instanceof RpcError)) return failure("host-unavailable", "Kernel Host is unavailable");
  if (error.code === "remote-error" && error.failure !== undefined && isProjectFailureCode(error.failure.code)) return failure(error.failure.code, error.failure.message);
  if (error.code === "invalid-output" || error.code === "invalid-frame") return failure("invalid-output", "Kernel Host returned a malformed project result");
  if (error.code === "invalid-input") return failure("invalid-input", "The project request is invalid");
  return failure("host-unavailable", `Kernel Host is unavailable (${error.code})`);
}

function failure(code: DesktopProjectFailure["code"], message: string): DesktopProjectFailure { return { code, message: message.slice(0, 2_048) }; }
function failed<T>(code: DesktopProjectFailure["code"], message: string): DesktopProjectResult<T> { return { type: "failed", failure: failure(code, message) }; }
