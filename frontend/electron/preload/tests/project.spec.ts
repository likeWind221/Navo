import { describe, expect, it } from "vitest";

import { createDesktopProjectApi } from "../project.js";
import type { ProjectIpcRenderer } from "../project.js";
import {
  PROJECT_CHOOSE_WORKSPACE_CHANNEL,
  PROJECT_CREATE_CHANNEL,
  PROJECT_GET_CHANNEL,
  PROJECT_LIST_CHANNEL,
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

describe("createDesktopProjectApi", () => {
  it("uses the four fixed channels and returns validated results", async () => {
    const ipc = new FakeIpc((channel) => {
      if (channel === PROJECT_LIST_CHANNEL) return { type: "ok", value: { projects: [summary] } };
      if (channel === PROJECT_CREATE_CHANNEL) return { type: "ok", value: summary };
      if (channel === PROJECT_GET_CHANNEL) {
        return { type: "ok", value: { project: summary, main: { sessionId: "s-1", turnActive: false }, roadmap: null } };
      }
      return { type: "ok", value: null };
    });
    const api = createDesktopProjectApi(ipc);

    expect(await api.list()).toEqual({ type: "ok", value: { projects: [summary] } });
    expect(await api.create({ name: "调研", goal: "整理资料", workspaceRoot: "D:\\work" }))
      .toEqual({ type: "ok", value: summary });
    expect((await api.get({ projectId: "project-1" })).type).toBe("ok");
    expect(await api.chooseWorkspace()).toEqual({ type: "ok", value: null });
    expect(ipc.calls).toEqual([
      [PROJECT_LIST_CHANNEL, {}],
      [PROJECT_CREATE_CHANNEL, { name: "调研", goal: "整理资料", workspaceRoot: "D:\\work" }],
      [PROJECT_GET_CHANNEL, { projectId: "project-1" }],
      [PROJECT_CHOOSE_WORKSPACE_CHANNEL, null],
    ]);
  });

  it("maps malformed results to invalid-output and rejected invokes to bridge-closed", async () => {
    const malformed = createDesktopProjectApi(new FakeIpc(() => ({ type: "ok", value: { ...summary, goal: "" } })));
    expect(await malformed.create({ name: "a", goal: "b", workspaceRoot: "c" })).toMatchObject({
      type: "failed", failure: { code: "invalid-output" },
    });

    const closed = createDesktopProjectApi({ invoke: () => Promise.reject(new Error("No handler registered")) });
    expect(await closed.list()).toMatchObject({ type: "failed", failure: { code: "bridge-closed" } });
  });
});

class FakeIpc implements ProjectIpcRenderer {
  readonly calls: [string, unknown][] = [];

  constructor(private readonly reply: (channel: string) => unknown) {}

  invoke(channel: string, value: unknown): Promise<unknown> {
    this.calls.push([channel, value]);
    return Promise.resolve(this.reply(channel));
  }
}
