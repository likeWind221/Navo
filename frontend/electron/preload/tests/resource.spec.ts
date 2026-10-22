import { describe, expect, it } from "vitest";
import type { DesktopResourceEvent } from "../../../shared/resource.js";
import {
  RESOURCE_BROWSE_CHANNEL,
  RESOURCE_CANCEL_CHANNEL,
  RESOURCE_CHOOSE_FILES_CHANNEL,
  RESOURCE_EVENT_CHANNEL,
  RESOURCE_FOLLOW_START_CHANNEL,
  RESOURCE_IMPORT_START_CHANNEL,
  RESOURCE_UPDATE_CHANNEL,
} from "../../../shared/resource/channels.js";
import { createDesktopResourceApi } from "../resource.js";
import type { ResourceIpcRenderer } from "../resource.js";

const item = { resourceId: "resource-1", owner: { kind: "user" }, name: "note.md", description: "",
  type: "text/markdown", libraryPath: "note.md", access: { kind: "public" }, revision: 1,
  assetGeneration: 1, createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z",
  content: { status: "pending", errorCode: null, errorMessage: null, updatedAt: "2026-10-22T00:00:00.000Z" } } as const;
const snapshot = { projectId: "project-1", path: null, directories: [], resources: [item] } as const;

describe("createDesktopResourceApi", () => {
  it("uses shared channels and validates every returned boundary", async () => {
    const ipc = new FakeIpc();
    ipc.responses.set(RESOURCE_BROWSE_CHANNEL, { type: "ok", value: snapshot });
    ipc.responses.set(RESOURCE_UPDATE_CHANNEL, { type: "ok", value: item });
    ipc.responses.set(RESOURCE_IMPORT_START_CHANNEL, { type: "ok", value: { subscriptionId: "import-1" } });
    ipc.responses.set(RESOURCE_FOLLOW_START_CHANNEL, { type: "ok", value: { subscriptionId: "follow-1" } });
    ipc.responses.set(RESOURCE_CANCEL_CHANNEL, { type: "ok", value: null });
    ipc.responses.set(RESOURCE_CHOOSE_FILES_CHANNEL, { type: "ok", value: [{ kind: "file", path: "C:\\note.md" }] });
    const api = createDesktopResourceApi(ipc);
    expect(await api.browse({ projectId: "project-1", path: null })).toEqual({ type: "ok", value: snapshot });
    expect(await api.update({ projectId: "project-1", resourceId: "resource-1", expectedRevision: 1,
      description: "new" })).toEqual({ type: "ok", value: item });
    expect(await api.startImport({ projectId: "project-1", requestId: "import_1",
      sources: [{ kind: "file", path: "C:\\note.md" }] })).toMatchObject({ type: "ok", value: { subscriptionId: "import-1" } });
    expect(await api.startFollow({ projectId: "project-1", path: null })).toMatchObject({ type: "ok" });
    expect(await api.cancel("import-1")).toEqual({ type: "ok", value: null });
    expect(await api.chooseFiles()).toMatchObject({ type: "ok", value: [{ kind: "file" }] });
  });

  it("drops malformed events and reports malformed or closed results", async () => {
    const ipc = new FakeIpc();
    ipc.responses.set(RESOURCE_BROWSE_CHANNEL, { type: "ok", value: { ...snapshot, resources: [{ ...item, revision: 0 }] } });
    let invalid = 0;
    const api = createDesktopResourceApi(ipc, () => { invalid += 1; });
    expect(await api.browse({ projectId: "project-1", path: null }))
      .toMatchObject({ type: "failed", failure: { code: "invalid-output" } });
    const events: DesktopResourceEvent[] = [];
    const unsubscribe = api.onEvent(event => events.push(event));
    ipc.emit(RESOURCE_EVENT_CHANNEL, { type: "library-snapshot", subscriptionId: "follow-1", snapshot });
    ipc.emit(RESOURCE_EVENT_CHANNEL, { type: "library-snapshot", subscriptionId: "follow-1", snapshot: {} });
    expect(events).toHaveLength(1);
    expect(invalid).toBe(1);
    unsubscribe();
    ipc.fail = true;
    expect(await api.cancel("follow-1")).toMatchObject({ type: "failed", failure: { code: "bridge-closed" } });
  });
});

class FakeIpc implements ResourceIpcRenderer {
  readonly responses = new Map<string, unknown>();
  readonly listeners = new Map<string, Set<(event: unknown, value: unknown) => void>>();
  fail = false;

  async invoke(channel: string): Promise<unknown> {
    if (this.fail) throw new Error("closed");
    return this.responses.get(channel);
  }
  on(channel: string, listener: (event: unknown, value: unknown) => void): void {
    const listeners = this.listeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
  }
  removeListener(channel: string, listener: (event: unknown, value: unknown) => void): void {
    this.listeners.get(channel)?.delete(listener);
  }
  emit(channel: string, value: unknown): void {
    for (const listener of this.listeners.get(channel) ?? []) listener({}, value);
  }
}
