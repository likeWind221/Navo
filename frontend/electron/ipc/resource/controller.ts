import { randomUUID } from "node:crypto";
import { RpcError } from "../../../../rpc/errors.js";
import type { RpcMethod, RpcStreamOptions } from "../../../../rpc/index.js";
import {
  resourceDeleteMethod,
  resourceFolderCreateMethod,
  resourceFolderDeleteMethod,
  resourceFolderOrganizeMethod,
  resourceLibraryBrowseMethod,
  resourceLibraryFollowMethod,
  resourceReplaceMethod,
  resourceUpdateMethod,
  userImportMethod,
} from "../../../../rpc/resource.js";
import type {
  DesktopResourceEvent,
  DesktopResourceFailure,
  DesktopResourceResult,
  DesktopResourceStreamHandle,
} from "../../../shared/resource.js";
import {
  DESKTOP_RESOURCE_FAILURE_MESSAGE_MAX_CHARS,
  isResourceFailureCode,
  parseDesktopResourceOperationId,
} from "../../../shared/resource/validation.js";

export interface ResourceHost {
  stream<TInput, TOutput>(method: RpcMethod<TInput, TOutput>, input: TInput, options?: RpcStreamOptions): AsyncIterable<TOutput>;
}

export interface ResourceTarget {
  readonly ownerId: number;
  isDestroyed(): boolean;
  send(event: DesktopResourceEvent): void;
}

interface ActiveStream {
  readonly subscriptionId: string;
  readonly kind: "import" | "follow";
  readonly target: ResourceTarget;
  readonly controller: AbortController;
  cancelled: boolean;
}

interface ActiveOperation {
  readonly operationId: string;
  readonly target: ResourceTarget;
  readonly controller: AbortController;
}

export class ResourceController {
  private readonly streams = new Map<string, ActiveStream>();
  private readonly operations = new Map<string, ActiveOperation>();
  private disposed = false;

  constructor(private readonly host: ResourceHost) {}

  browse(candidate: unknown) { return call(this.host, resourceLibraryBrowseMethod, candidate); }
  createFolder(candidate: unknown) { return call(this.host, resourceFolderCreateMethod, candidate); }
  organizeFolder(candidate: unknown) { return call(this.host, resourceFolderOrganizeMethod, candidate); }
  update(candidate: unknown) { return call(this.host, resourceUpdateMethod, candidate); }
  delete(candidate: unknown) { return call(this.host, resourceDeleteMethod, candidate); }

  deleteFolder(target: ResourceTarget, candidate: unknown) {
    return this.operation(target, resourceFolderDeleteMethod, candidate, input => input.operationId);
  }

  replace(target: ResourceTarget, candidate: unknown) {
    return this.operation(target, resourceReplaceMethod, candidate, input => input.operationId);
  }

  startImport(target: ResourceTarget, candidate: unknown): DesktopResourceResult<DesktopResourceStreamHandle> {
    return this.start(target, "import", userImportMethod, candidate);
  }

  startFollow(target: ResourceTarget, candidate: unknown): DesktopResourceResult<DesktopResourceStreamHandle> {
    return this.start(target, "follow", resourceLibraryFollowMethod, candidate);
  }

  cancel(ownerId: number, candidate: unknown): DesktopResourceResult<null> {
    let operationId: string;
    try {
      operationId = parseDesktopResourceOperationId(candidate);
    } catch {
      return failed("invalid-input", "The resource operation identity is invalid");
    }
    const stream = this.streams.get(operationId);
    if (stream?.target.ownerId === ownerId) this.cancelStream(stream, true);
    const operation = this.operations.get(this.key(ownerId, operationId));
    if (operation !== undefined) operation.controller.abort("Renderer cancelled the resource operation");
    return { type: "ok", value: null };
  }

  cancelOwner(ownerId: number): void {
    for (const stream of [...this.streams.values()]) {
      if (stream.target.ownerId === ownerId) this.cancelStream(stream, false);
    }
    for (const operation of this.operations.values()) {
      if (operation.target.ownerId === ownerId) operation.controller.abort("Renderer was destroyed");
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const stream of [...this.streams.values()]) this.cancelStream(stream, false);
    for (const operation of this.operations.values()) operation.controller.abort("Resource bridge was disposed");
  }

  private start<TInput, TOutput>(target: ResourceTarget, kind: ActiveStream["kind"],
    method: RpcMethod<TInput, TOutput>, candidate: unknown): DesktopResourceResult<DesktopResourceStreamHandle> {
    if (this.disposed) return failed("bridge-closed", "Resource bridge is closed");
    let input: TInput;
    try {
      input = method.parseInput(candidate);
    } catch {
      return failed("invalid-input", "The resource request is invalid");
    }
    const stream: ActiveStream = { subscriptionId: randomUUID(), kind, target,
      controller: new AbortController(), cancelled: false };
    this.streams.set(stream.subscriptionId, stream);
    void this.run(stream, method, input);
    return { type: "ok", value: { subscriptionId: stream.subscriptionId } };
  }

  private async run<TInput, TOutput>(stream: ActiveStream, method: RpcMethod<TInput, TOutput>, input: TInput): Promise<void> {
    try {
      for await (const candidate of this.host.stream(method, input, { signal: stream.controller.signal })) {
        const output = method.parseOutput(candidate);
        if (stream.kind === "import") {
          this.publish(stream, { type: "import-item", subscriptionId: stream.subscriptionId,
            item: output as import("../../../../rpc/resource.js").UserImportItemV1 });
        } else {
          const snapshot = output as import("../../../../rpc/resource.js").ResourceLibrarySnapshotV1;
          const requested = input as import("../../../../rpc/resource.js").ResourceLibraryInputV1;
          if (snapshot.projectId !== requested.projectId || snapshot.path !== requested.path) {
            throw new RpcError("invalid-output", "Resource library follow crossed its requested scope");
          }
          this.publish(stream, { type: "library-snapshot", subscriptionId: stream.subscriptionId,
            snapshot });
        }
      }
      if (!stream.cancelled && stream.kind === "import") {
        this.publish(stream, { type: "stream-complete", subscriptionId: stream.subscriptionId, status: "completed" });
      } else if (!stream.cancelled && stream.kind === "follow") {
        this.publish(stream, { type: "stream-error", subscriptionId: stream.subscriptionId,
          failure: { code: "host-unavailable", message: "Resource library follow ended" } });
      }
    } catch (error) {
      if (!stream.cancelled && !this.disposed) {
        this.publish(stream, { type: "stream-error", subscriptionId: stream.subscriptionId,
          failure: toResourceFailure(error) });
      }
    } finally {
      if (this.streams.get(stream.subscriptionId) === stream) this.streams.delete(stream.subscriptionId);
    }
  }

  private async operation<TInput, TOutput>(target: ResourceTarget, method: RpcMethod<TInput, TOutput>,
    candidate: unknown, identify: (input: TInput) => string): Promise<DesktopResourceResult<TOutput>> {
    if (this.disposed) return failed("bridge-closed", "Resource bridge is closed");
    let input: TInput;
    try {
      input = method.parseInput(candidate);
    } catch {
      return failed("invalid-input", "The resource request is invalid");
    }
    const operationId = identify(input);
    const key = this.key(target.ownerId, operationId);
    if (this.operations.has(key)) return failed("operation-conflict", "The resource operation is already running");
    const operation: ActiveOperation = { operationId, target, controller: new AbortController() };
    this.operations.set(key, operation);
    try {
      return await callParsed(this.host, method, input, operation.controller.signal);
    } finally {
      if (this.operations.get(key) === operation) this.operations.delete(key);
    }
  }

  private cancelStream(stream: ActiveStream, notify: boolean): void {
    if (this.streams.get(stream.subscriptionId) !== stream) return;
    this.streams.delete(stream.subscriptionId);
    stream.cancelled = true;
    stream.controller.abort("Resource stream was cancelled");
    if (notify && stream.kind === "import" && !stream.target.isDestroyed()) {
      stream.target.send({ type: "stream-complete", subscriptionId: stream.subscriptionId, status: "cancelled" });
    }
  }

  private publish(stream: ActiveStream, event: DesktopResourceEvent): void {
    if (this.streams.get(stream.subscriptionId) !== stream || stream.target.isDestroyed()) return;
    stream.target.send(event);
  }

  private key(ownerId: number, operationId: string): string {
    return `${ownerId}\0${operationId}`;
  }
}

async function call<TInput, TOutput>(host: ResourceHost, method: RpcMethod<TInput, TOutput>,
  candidate: unknown): Promise<DesktopResourceResult<TOutput>> {
  let input: TInput;
  try {
    input = method.parseInput(candidate);
  } catch {
    return failed("invalid-input", "The resource request is invalid");
  }
  return callParsed(host, method, input);
}

async function callParsed<TInput, TOutput>(host: ResourceHost, method: RpcMethod<TInput, TOutput>, input: TInput,
  signal?: AbortSignal): Promise<DesktopResourceResult<TOutput>> {
  try {
    const outputs: TOutput[] = [];
    for await (const candidate of host.stream(method, input, signal === undefined ? undefined : { signal })) {
      outputs.push(method.parseOutput(candidate));
    }
    const [value] = outputs;
    if (outputs.length !== 1 || value === undefined) return failed("invalid-output", "Resource method must return exactly one result");
    return { type: "ok", value };
  } catch (error) {
    return { type: "failed", failure: toResourceFailure(error) };
  }
}

function toResourceFailure(error: unknown): DesktopResourceFailure {
  if (!(error instanceof RpcError)) return { code: "host-unavailable", message: "Kernel Host is unavailable" };
  if (error.code === "remote-error") {
    const remote = error.failure;
    if (remote !== undefined && isResourceFailureCode(remote.code)) {
      return { code: remote.code, message: bounded(remote.message) };
    }
    return { code: "internal", message: "Resource operation failed" };
  }
  if (error.code === "invalid-output" || error.code === "invalid-frame") {
    return { code: "invalid-output", message: "Kernel Host returned a malformed resource result" };
  }
  if (error.code === "invalid-input") return { code: "invalid-input", message: "The resource request is invalid" };
  if (error.code === "cancelled") return { code: "cancelled", message: "The resource operation was cancelled" };
  return { code: "host-unavailable", message: `Kernel Host is unavailable (${error.code})` };
}

function bounded(message: string): string {
  const text = message.trim() || "Resource operation failed";
  return text.length > DESKTOP_RESOURCE_FAILURE_MESSAGE_MAX_CHARS
    ? text.slice(0, DESKTOP_RESOURCE_FAILURE_MESSAGE_MAX_CHARS) : text;
}

function failed<T>(code: DesktopResourceFailure["code"], message: string): DesktopResourceResult<T> {
  return { type: "failed", failure: { code, message } };
}
