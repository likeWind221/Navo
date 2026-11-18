import { describe, expect, it } from "vitest";

import { createDesktopProjectApi } from "../project.js";
import type { ProjectIpcRenderer } from "../project.js";
import {
  PROJECT_CHOOSE_WORKSPACE_CHANNEL,
  PROJECT_CREATE_CHANNEL,
  PROJECT_GET_CHANNEL,
  PROJECT_SESSIONS_CHANNEL,
  PROJECT_LIST_CHANNEL,
  PROJECT_NODE_REVIEW_CHANNEL,
} from "../../../shared/project/channels.js";

const summary = {
  projectId: "project-1",
  name: "调研",
  goal: "整理资料",
  workspaceRoot: "D:\\work",
  status: "active",
  revision: 1,
  createdAt: "2026-10-08T00:00:00.000Z",
} as const;

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
} as const;

describe("createDesktopProjectApi", () => {
  it("validates session recovery through its dedicated channel", async () => {
    const recovery = { projectId: "project-1", sessions: [{ owner: { kind: "node", nodeId: "node-1" }, status: "available", sessionId: "node-session", lastEndedTurn: null }] };
    const ipc = new FakeIpc(() => ({ type: "ok", value: recovery }));
    expect(await createDesktopProjectApi(ipc).getSessions({ projectId: "project-1" })).toEqual({ type: "ok", value: recovery });
    expect(ipc.calls).toEqual([[PROJECT_SESSIONS_CHANNEL, { projectId: "project-1" }]]);
    const malformed = createDesktopProjectApi(new FakeIpc(() => ({ type: "ok", value: { projectId: "project-1", sessions: [{ status: "available" }] } })));
    expect(await malformed.getSessions({ projectId: "project-1" })).toMatchObject({ type: "failed", failure: { code: "invalid-output" } });
  });
  it("uses the four fixed channels and returns validated results", async () => {
    const ipc = new FakeIpc((channel) => {
      if (channel === PROJECT_LIST_CHANNEL) return { type: "ok", value: { projects: [summary] } };
      if (channel === PROJECT_CREATE_CHANNEL) return { type: "ok", value: summary };
      if (channel === PROJECT_GET_CHANNEL) {
        return { type: "ok", value: { project: summary, main: { sessionId: "s-1", turnActive: false }, roadmap: null } };
      }
      if (channel === PROJECT_NODE_REVIEW_CHANNEL) return { type: "ok", value: node };
      return { type: "ok", value: null };
    });
    const api = createDesktopProjectApi(ipc);

    expect(await api.list()).toEqual({ type: "ok", value: { projects: [summary] } });
    expect(await api.create({ name: "调研", goal: "整理资料", workspaceRoot: "D:\\work" }))
      .toEqual({ type: "ok", value: summary });
    expect((await api.get({ projectId: "project-1" })).type).toBe("ok");
    expect(await api.review({ projectId: "project-1", nodeId: "node-1", action: "complete", reason: "人工验收通过", reviewedRevision: 3 }))
      .toEqual({ type: "ok", value: node });
    expect(await api.chooseWorkspace()).toEqual({ type: "ok", value: null });
    expect(ipc.calls).toEqual([
      [PROJECT_LIST_CHANNEL, {}],
      [PROJECT_CREATE_CHANNEL, { name: "调研", goal: "整理资料", workspaceRoot: "D:\\work" }],
      [PROJECT_GET_CHANNEL, { projectId: "project-1" }],
      [PROJECT_NODE_REVIEW_CHANNEL, { projectId: "project-1", nodeId: "node-1", action: "complete", reason: "人工验收通过", reviewedRevision: 3 }],
      [PROJECT_CHOOSE_WORKSPACE_CHANNEL, null],
    ]);
  });

  it("maps malformed results to invalid-output and rejected invokes to bridge-closed", async () => {
    const malformed = createDesktopProjectApi(new FakeIpc(() => ({ type: "ok", value: { ...summary, goal: "" } })));
    expect(await malformed.create({ name: "a", goal: "b", workspaceRoot: "c" })).toMatchObject({
      type: "failed", failure: { code: "invalid-output" },
    });

    const closed = createDesktopProjectApi({ invoke: () => Promise.reject(new Error("No handler registered")), on() {}, removeListener() {} });
    expect(await closed.list()).toMatchObject({ type: "failed", failure: { code: "bridge-closed" } });
  });
});

class FakeIpc implements ProjectIpcRenderer {
  readonly calls: [string, unknown][] = [];

  on(): void {}
  removeListener(): void {}

  constructor(private readonly reply: (channel: string) => unknown) {}

  invoke(channel: string, value: unknown): Promise<unknown> {
    this.calls.push([channel, value]);
    return Promise.resolve(this.reply(channel));
  }
}
