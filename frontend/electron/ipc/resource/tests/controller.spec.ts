import { describe, expect, it, vi } from "vitest";
import { RpcError } from "../../../../../rpc/errors.js";
import type { RpcMethod, RpcStreamOptions } from "../../../../../rpc/index.js";
import type { DesktopResourceEvent } from "../../../../shared/resource.js";
import { ResourceController } from "../controller.js";
import type { ResourceHost, ResourceTarget } from "../controller.js";

const snapshot = { projectId: "project-1", path: null, directories: [], resources: [] } as const;
const saved = { status: "saved", name: "note.md", relativePath: "note.md", resourceId: "resource-1",
  libraryPath: "note.md", contentStatus: "pending" } as const;

describe("ResourceController requests", () => {
  it("validates unary input and rejects malformed or multiple outputs", async () => {
    const host = new FakeHost();
    host.outputs.set("resource.library.browse.v1", async function* () { yield snapshot; });
    const controller = new ResourceController(host);
    expect(await controller.browse({ projectId: "project-1", path: null }))
      .toEqual({ type: "ok", value: snapshot });
    expect(await controller.browse({ projectId: "", path: null }))
      .toMatchObject({ type: "failed", failure: { code: "invalid-input" } });

    host.outputs.set("resource.library.browse.v1", async function* () { yield { ...snapshot, extra: true }; });
    expect(await controller.browse({ projectId: "project-1", path: null }))
      .toMatchObject({ type: "failed", failure: { code: "invalid-output" } });
    host.outputs.set("resource.library.browse.v1", async function* () { yield snapshot; yield snapshot; });
    expect(await controller.browse({ projectId: "project-1", path: null }))
      .toMatchObject({ type: "failed", failure: { code: "invalid-output" } });
  });

  it("maps remote failures and cancels long operations by owner", async () => {
    const host = new FakeHost();
    host.outputs.set("resource.update.v1", async function* () {
      throw new RpcError("remote-error", "stale", {
        failure: { code: "revision-conflict", message: "stale", details: {} },
      });
    });
    const controller = new ResourceController(host);
    expect(await controller.update({ projectId: "project-1", resourceId: "resource-1",
      expectedRevision: 1, description: "new" }))
      .toMatchObject({ type: "failed", failure: { code: "revision-conflict" } });

    host.outputs.set("resource.replace.v1", signal => untilAbort(signal));
    const target = new FakeTarget(7);
    const replacement = controller.replace(target, { projectId: "project-1", resourceId: "resource-1",
      expectedRevision: 1, operationId: "replace_1", sourcePath: "C:\\replacement.md" });
    await vi.waitFor(() => expect(host.calls.at(-1)?.signal?.aborted).toBe(false));
    controller.cancelOwner(8);
    expect(host.calls.at(-1)?.signal?.aborted).toBe(false);
    controller.cancelOwner(7);
    await expect(replacement).resolves.toMatchObject({ type: "failed", failure: { code: "cancelled" } });
  });
});

describe("ResourceController streams", () => {
  it("streams import items, reports completion and supports explicit cancellation", async () => {
    const host = new FakeHost();
    host.outputs.set("resource.user-import.v1", async function* () { yield saved; });
    const controller = new ResourceController(host);
    const target = new FakeTarget(1);
    const started = controller.startImport(target, { projectId: "project-1", requestId: "import_1",
      sources: [{ kind: "file", path: "C:\\note.md" }] });
    expect(started.type).toBe("ok");
    await vi.waitFor(() => expect(target.events).toHaveLength(2));
    expect(target.events.map(event => event.type)).toEqual(["import-item", "stream-complete"]);

    host.outputs.set("resource.user-import.v1", signal => itemThenWait(signal));
    const cancelled = controller.startImport(target, { projectId: "project-1", requestId: "import_2",
      sources: [{ kind: "file", path: "C:\\note.md" }] });
    if (cancelled.type !== "ok") return;
    await vi.waitFor(() => expect(target.events.filter(event => event.type === "import-item")).toHaveLength(2));
    expect(controller.cancel(2, cancelled.value.subscriptionId)).toEqual({ type: "ok", value: null });
    expect(host.calls.at(-1)?.signal?.aborted).toBe(false);
    expect(controller.cancel(1, cancelled.value.subscriptionId)).toEqual({ type: "ok", value: null });
    await vi.waitFor(() => expect(target.events.at(-1)).toMatchObject({ type: "stream-complete", status: "cancelled" }));
    expect(host.calls.at(-1)?.signal?.aborted).toBe(true);
  });

  it("isolates follow streams, validates scope and cleans up destroyed owners", async () => {
    const host = new FakeHost();
    host.outputs.set("resource.library.follow.v1", signal => snapshotThenWait(snapshot, signal));
    const controller = new ResourceController(host);
    const first = new FakeTarget(1);
    const second = new FakeTarget(2);
    controller.startFollow(first, { projectId: "project-1", path: null });
    controller.startFollow(second, { projectId: "project-1", path: null });
    await vi.waitFor(() => expect(first.events).toHaveLength(1));
    await vi.waitFor(() => expect(second.events).toHaveLength(1));
    controller.cancelOwner(1);
    expect(host.calls[0]?.signal?.aborted).toBe(true);
    expect(host.calls[1]?.signal?.aborted).toBe(false);
    second.destroyed = true;
    controller.cancelOwner(2);
    expect(host.calls[1]?.signal?.aborted).toBe(true);

    host.outputs.set("resource.library.follow.v1", async function* () {
      yield { ...snapshot, projectId: "project-2" };
    });
    const malformed = new FakeTarget(3);
    controller.startFollow(malformed, { projectId: "project-1", path: null });
    await vi.waitFor(() => expect(malformed.events).toHaveLength(1));
    expect(malformed.events[0]).toMatchObject({ type: "stream-error", failure: { code: "invalid-output" } });
  });
});

class FakeHost implements ResourceHost {
  readonly calls: Array<{ method: string; input: unknown; signal: AbortSignal | undefined }> = [];
  readonly outputs = new Map<string, (signal: AbortSignal | undefined) => AsyncIterable<unknown>>();

  stream<TInput, TOutput>(method: RpcMethod<TInput, TOutput>, input: TInput, options?: RpcStreamOptions): AsyncIterable<TOutput> {
    this.calls.push({ method: method.name, input, signal: options?.signal });
    const output = this.outputs.get(method.name);
    return (output === undefined ? (async function* () {})() : output(options?.signal)) as AsyncIterable<TOutput>;
  }
}

class FakeTarget implements ResourceTarget {
  readonly events: DesktopResourceEvent[] = [];
  destroyed = false;

  constructor(readonly ownerId: number) {}
  isDestroyed(): boolean { return this.destroyed; }
  send(event: DesktopResourceEvent): void { this.events.push(event); }
}

function untilAbort(signal: AbortSignal | undefined): AsyncIterable<unknown> {
  return (async function* () {
    await aborted(signal);
    throw new RpcError("cancelled", "cancelled");
  })();
}

function itemThenWait(signal: AbortSignal | undefined): AsyncIterable<unknown> {
  return (async function* () {
    yield saved;
    await aborted(signal);
    throw new RpcError("cancelled", "cancelled");
  })();
}

function snapshotThenWait(value: unknown, signal: AbortSignal | undefined): AsyncIterable<unknown> {
  return (async function* () {
    yield value;
    await aborted(signal);
  })();
}

function aborted(signal: AbortSignal | undefined): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted === true) resolve();
    else signal?.addEventListener("abort", () => resolve(), { once: true });
  });
}
