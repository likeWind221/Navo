import { describe, expect, it } from "vitest";

import { RpcError } from "../../../../../rpc/errors.js";
import type { RpcMethod } from "../../../../../rpc/index.js";
import { chooseWorkspace, createProjectHandlers } from "../handler.js";
import type { ProjectHost } from "../handler.js";

const summary = {
  projectId: "project-1",
  name: "调研",
  goal: "整理资料",
  workspaceRoot: "D:\\work",
  status: "active" as const,
  revision: 1,
  createdAt: "2026-10-08T00:00:00.000Z",
};

const createInput = { name: "调研", goal: "整理资料", workspaceRoot: "D:\\work" };
const node = {
  nodeId: "node-1",
  revision: 3,
  requirement: "required" as const,
  status: "submitted" as const,
  title: "整理资料",
  description: "整理可用资料",
  acceptanceCriteria: ["保留来源"],
  hasSession: true,
  turnActive: false,
  actions: { run: false, complete: true, skip: true, rework: true, review: true },
  confirmation: null,
  submission: {
    summary: "已整理资料并保留来源",
    resourceIds: ["resource-1"],
    criteria: [{ criterion: "保留来源", satisfied: true, note: "已保存引用" }],
    remaining: [],
    submittedAt: "2026-11-17T00:00:00.000Z",
  },
  pendingFeedback: null,
  review: null,
  reworkCount: 0,
  reviewPending: true,
};
const review = { projectId: "project-1", nodeId: "node-1", action: "rework" as const, reason: "补充来源", reviewedRevision: 3 };

describe("createProjectHandlers", () => {
  it("forwards session recovery to the existing Host method", async () => {
    const recovery = { projectId: "project-1", sessions: [{ owner: { kind: "node", nodeId: "node-1" }, status: "unestablished" }] };
    const host = new FakeHost(async function* () { yield recovery; });
    expect(await createProjectHandlers(host).getSessions({ projectId: "project-1" })).toEqual({ type: "ok", value: recovery });
    expect(host.calls).toEqual([["project.session.recovery.v1", { projectId: "project-1" }]]);
  });
  it("passes validated input to the Host and returns its single result", async () => {
    const host = new FakeHost(async function* () { yield summary; });

    expect(await createProjectHandlers(host).create(createInput)).toEqual({ type: "ok", value: summary });
    expect(host.calls).toEqual([["project.create.v1", createInput]]);
  });

  it("passes a null goal through to the Host", async () => {
    const pending = { ...summary, goal: null };
    const host = new FakeHost(async function* () { yield pending; });

    expect(await createProjectHandlers(host).create({ ...createInput, goal: null }))
      .toEqual({ type: "ok", value: pending });
    expect(host.calls).toEqual([["project.create.v1", { ...createInput, goal: null }]]);
  });

  it("passes validated review input to the Host and returns the updated Node", async () => {
    const host = new FakeHost(async function* () { yield node; });

    expect(await createProjectHandlers(host).review(review)).toEqual({ type: "ok", value: node });
    expect(host.calls).toEqual([["project.node.review.v1", review]]);
  });

  it("rejects invalid review input before calling the Host", async () => {
    const host = new FakeHost(async function* () { yield node; });
    const handlers = createProjectHandlers(host);

    expect(await handlers.review({ ...review, reason: "  " })).toMatchObject({ type: "failed", failure: { code: "invalid-input" } });
    expect(await handlers.review({ ...review, reviewedRevision: 0 })).toMatchObject({ type: "failed", failure: { code: "invalid-input" } });
    expect(host.calls).toEqual([]);
  });

  it("rejects invalid input before calling the Host", async () => {
    const host = new FakeHost(async function* () { yield summary; });
    const handlers = createProjectHandlers(host);

    expect(await handlers.create({ ...createInput, goal: "   " })).toMatchObject({
      type: "failed", failure: { code: "invalid-input" },
    });
    expect(await handlers.create({ name: createInput.name, workspaceRoot: createInput.workspaceRoot }))
      .toMatchObject({ type: "failed", failure: { code: "invalid-input" } });
    expect(await handlers.get({ projectId: "" })).toMatchObject({ type: "failed", failure: { code: "invalid-input" } });
    expect(await handlers.list({ extra: true })).toMatchObject({ type: "failed", failure: { code: "invalid-input" } });
    expect(host.calls).toEqual([]);
  });

  it("passes project failure codes from remote errors through unchanged", async () => {
    const host = new FakeHost(async function* () {
      throw new RpcError("remote-error", "Workspace is already bound", {
        failure: { code: "workspace-conflict", message: "Workspace is already bound", details: {} },
      });
    });

    expect(await createProjectHandlers(host).create(createInput)).toEqual({
      type: "failed", failure: { code: "workspace-conflict", message: "Workspace is already bound" },
    });
  });

  it("maps unknown remote codes to internal and transport failures to host-unavailable", async () => {
    const unknownRemote = new FakeHost(async function* () {
      throw new RpcError("remote-error", "boom", { failure: { code: "stream-failed", message: "boom", details: {} } });
    });
    expect(await createProjectHandlers(unknownRemote).list({})).toMatchObject({
      type: "failed", failure: { code: "internal", message: "stream-failed: boom" },
    });

    const closed = new FakeHost(async function* () { throw new RpcError("connection-closed", "closed"); });
    expect(await createProjectHandlers(closed).list({})).toMatchObject({
      type: "failed", failure: { code: "host-unavailable" },
    });

    const startup = new FakeHost(async function* () { throw new Error("Kernel Host exited before ready"); });
    expect(await createProjectHandlers(startup).list({})).toMatchObject({
      type: "failed", failure: { code: "host-unavailable" },
    });
  });

  it("maps malformed or missing Host output to invalid-output", async () => {
    const malformed = new FakeHost(async function* () { throw new RpcError("invalid-frame", "Malformed project summary"); });
    expect(await createProjectHandlers(malformed).create(createInput)).toMatchObject({
      type: "failed", failure: { code: "invalid-output" },
    });

    const empty = new FakeHost(async function* () {});
    expect(await createProjectHandlers(empty).list({})).toMatchObject({
      type: "failed", failure: { code: "invalid-output" },
    });
  });
});

describe("chooseWorkspace", () => {
  it("returns null when the dialog is cancelled and the first path otherwise", async () => {
    expect(await chooseWorkspace(async () => ({ canceled: true, filePaths: [] }))).toEqual({ type: "ok", value: null });
    expect(await chooseWorkspace(async () => ({ canceled: false, filePaths: ["D:\\work"] })))
      .toEqual({ type: "ok", value: "D:\\work" });
  });
});

class FakeHost implements ProjectHost {
  readonly calls: [string, unknown][] = [];

  constructor(private readonly outputs: () => AsyncIterable<unknown>) {}

  stream<TInput, TOutput>(method: RpcMethod<TInput, TOutput>, input: TInput): AsyncIterable<TOutput> {
    this.calls.push([method.name, input]);
    return this.outputs() as AsyncIterable<TOutput>;
  }
}
