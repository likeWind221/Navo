import { describe, expect, it, vi } from "vitest";
import type { DesktopSessionApi } from "../../../shared/session.js";
import type { DesktopProjectApi } from "../../../shared/project.js";
import { ProjectRuntime } from "./runtime.js";

describe("Main history", () => {
  it("loads all pages once and keeps the same snapshot when the view reopens", async () => {
    const getHistory = vi.fn()
      .mockResolvedValueOnce({ type: "ok", value: { entries: [{ kind: "message", sequence: 1, timestamp: "2026-11-17T00:00:00Z", message: { id: "one", role: "user", content: [{ type: "text", text: "先前的问题" }] } }], nextCursor: { surfaceGeneration: 3, offset: 1 } } })
      .mockResolvedValueOnce({ type: "ok", value: { entries: [{ kind: "message", sequence: 2, timestamp: "2026-11-17T00:00:01Z", message: { id: "two", role: "assistant", content: [{ type: "text", text: "先前的回答" }] } }], nextCursor: null } });
    const runtime = new ProjectRuntime(undefined, { getHistory } as unknown as DesktopSessionApi);
    expect((await runtime.mainHistory("s-1")).map(entry => entry.message.id)).toEqual(["one", "two"]);
    expect(getHistory).toHaveBeenNthCalledWith(2, { sessionId: "s-1", limit: 50, cursor: { surfaceGeneration: 3, offset: 1 } });
    expect(await runtime.mainHistory("s-1")).toHaveLength(2);
    expect(getHistory).toHaveBeenCalledTimes(2);
  });

  it("lets the user retry from the first page after the history changes", async () => {
    const getHistory = vi.fn()
      .mockResolvedValueOnce({ type: "failed", failure: { code: "history-changed", message: "changed" } })
      .mockResolvedValueOnce({ type: "ok", value: { entries: [], nextCursor: null } });
    const runtime = new ProjectRuntime(undefined, { getHistory } as unknown as DesktopSessionApi);
    await expect(runtime.mainHistory("s-1")).rejects.toThrow("历史在读取期间发生变化");
    await expect(runtime.mainHistory("s-1")).resolves.toEqual([]);
    expect(getHistory).toHaveBeenLastCalledWith({ sessionId: "s-1", limit: 50 });
  });
});

describe("Node history", () => {
  it("locates the correct Node session and retains its baseline across view switches", async () => {
    const getSessions = vi.fn().mockResolvedValue({ type: "ok", value: { projectId: "p", sessions: [
      { owner: { kind: "node", nodeId: "other" }, status: "available", sessionId: "other-session", lastEndedTurn: null },
      { owner: { kind: "node", nodeId: "n" }, status: "available", sessionId: "node-session", lastEndedTurn: null },
    ] } });
    const getHistory = vi.fn().mockResolvedValue({ type: "ok", value: { entries: [{ kind: "message", sequence: 1, timestamp: "2026-11-17T00:00:00Z", message: { id: "old", role: "user", content: [{ type: "text", text: "旧消息" }] } }], nextCursor: null } });
    const runtime = new ProjectRuntime({ getSessions } as unknown as DesktopProjectApi, { getHistory } as unknown as DesktopSessionApi);
    expect(await runtime.nodeHistory("p", "n")).toMatchObject({ established: true, entries: [{ message: { id: "old" } }] });
    await runtime.nodeHistory("p", "n");
    expect(getSessions).toHaveBeenCalledTimes(1);
    expect(getHistory).toHaveBeenCalledExactlyOnceWith({ sessionId: "node-session", limit: 50 });
  });

  it("distinguishes a new Node from unavailable and missing session records", async () => {
    const getSessions = vi.fn()
      .mockResolvedValueOnce({ type: "ok", value: { projectId: "p", sessions: [{ owner: { kind: "node", nodeId: "n" }, status: "unestablished" }] } })
      .mockResolvedValueOnce({ type: "ok", value: { projectId: "p", sessions: [{ owner: { kind: "node", nodeId: "unavailable" }, status: "unavailable", sessionId: "s", reason: "not-readable" }] } })
      .mockResolvedValueOnce({ type: "ok", value: { projectId: "p", sessions: [] } });
    const runtime = new ProjectRuntime({ getSessions } as unknown as DesktopProjectApi);
    expect(await runtime.nodeHistory("p", "n")).toEqual({ established: false, entries: [] });
    await expect(runtime.nodeHistory("p", "unavailable")).rejects.toThrow("节点会话暂时无法读取");
    await expect(runtime.nodeHistory("p", "missing")).rejects.toThrow("未找到节点会话状态");
  });
});
