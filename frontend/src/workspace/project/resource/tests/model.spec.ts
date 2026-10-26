import { describe, expect, it } from "vitest";
import type { ResourceLibraryItemV1 } from "../../../../../../rpc/resource.js";
import { createPendingFollowEvents, type PendingFollowEvent } from "../follow.js";
import { resourceFailureMessage } from "../failure.js";
import { ownerLabel, parentPath, resourceStatus } from "../model.js";

const snapshot = (projectId: string, path: string | null): PendingFollowEvent => ({
  type: "library-snapshot", subscriptionId: "follow-current", snapshot: {
    projectId, path, directories: [], resources: [],
  },
});

describe("resource library model", () => {
  it("normalizes root navigation and preserves nested parents", () => {
    expect(parentPath(null)).toBeNull();
    expect(parentPath("notes")).toBeNull();
    expect(parentPath("notes/research")).toBe("notes");
  });

  it("presents content states and owners without claiming search readiness", () => {
    const item: ResourceLibraryItemV1 = {
      resourceId: "resource-1", owner: { kind: "main" }, name: "笔记", description: "", type: "text/markdown",
      libraryPath: "", access: { kind: "private" }, revision: 1, assetGeneration: 1,
      createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
      content: { status: "ready", errorCode: null, errorMessage: null, updatedAt: "2026-10-01T00:00:00.000Z" },
    };
    expect(resourceStatus({ ...item, content: null })).toEqual({ label: "尚未处理", tone: "neutral" });
    expect(resourceStatus(item)).toEqual({ label: "正文就绪", tone: "ready" });
    expect(ownerLabel(item)).toBe("Main");
    expect(ownerLabel({ ...item, owner: { kind: "node", nodeId: "node-1" } })).toBe("Node node-1");
  });

  it("turns bridge failures into actionable Chinese feedback", () => {
    expect(resourceFailureMessage({ code: "folder-unavailable", message: "RPC stream failed" })).toContain("当前目录");
    expect(resourceFailureMessage({ code: "host-unavailable", message: "Host unavailable" })).toContain("服务未连接");
  });
});

describe("pending follow events", () => {
  it("replays only the handle that startFollow eventually acknowledges", () => {
    const events = createPendingFollowEvents();
    events.add(snapshot("project-1", null), "project-1", null);
    events.add({ type: "stream-error", subscriptionId: "old", failure: { code: "internal", message: "old" } }, "project-1", null);
    expect(events.take("old")).toMatchObject([{ type: "stream-error" }]);
    expect(events.take("follow-current")).toMatchObject([{ type: "library-snapshot" }]);
    expect(events.take("other")).toEqual([]);
  });

  it("filters snapshots from another project or path and replays data before terminal error", () => {
    const events = createPendingFollowEvents();
    events.add(snapshot("other", null), "project-1", null);
    events.add(snapshot("project-1", "nested"), "project-1", null);
    events.add(snapshot("project-1", null), "project-1", null);
    events.add({ type: "stream-error", subscriptionId: "follow-current", failure: { code: "internal", message: "断开" } }, "project-1", null);
    expect(events.take("follow-current").map(event => event.type)).toEqual(["library-snapshot", "stream-error"]);
    expect(events.take("other")).toEqual([]);
  });
});
