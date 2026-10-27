import { describe, expect, it } from "vitest";
import type { DesktopResourceEvent } from "../../../../../shared/resource.js";
import { applyResourceOperationEvent, type ResourceOperation } from "../operations.js";

const base: ResourceOperation = {
  id: "import-1", kind: "import", label: "导入资料", status: "running", subscriptionId: "sub-1", items: [], failure: null, deleteResult: null,
};

const saved: DesktopResourceEvent = {
  type: "import-item", subscriptionId: "sub-1",
  item: { status: "saved", name: "note.md", relativePath: "note.md", resourceId: "resource-1", libraryPath: "note.md", contentStatus: "ready" },
};

describe("resource operation events", () => {
  it("keeps each item event and marks failed items as partial on completion", () => {
    const failed: DesktopResourceEvent = { type: "import-item", subscriptionId: "sub-1", item: { status: "failed", name: "note.md", relativePath: "note.md", code: "parse", message: "解析失败" } };
    const completed: DesktopResourceEvent = { type: "stream-complete", subscriptionId: "sub-1", status: "completed" };
    const next = applyResourceOperationEvent(applyResourceOperationEvent(base, saved), failed);
    expect(next.items).toHaveLength(2);
    expect(next.items[0]).toMatchObject({ status: "saved", relativePath: "note.md" });
    expect(next.items[1]).toMatchObject({ status: "failed", relativePath: "note.md" });
    expect(applyResourceOperationEvent(next, completed).status).toBe("partial");
  });

  it("ignores another operation and preserves items before a stream error", () => {
    const other: DesktopResourceEvent = { type: "stream-error", subscriptionId: "sub-other", failure: { code: "internal", message: "另一个操作失败" } };
    const error: DesktopResourceEvent = { type: "stream-error", subscriptionId: "sub-1", failure: { code: "host-unavailable", message: "服务断开" } };
    const withItem = applyResourceOperationEvent(base, saved);
    expect(applyResourceOperationEvent(withItem, other)).toBe(withItem);
    expect(applyResourceOperationEvent(withItem, error)).toMatchObject({ status: "failed", items: [saved.item] });
  });

  it("records an explicit cancelled terminal event", () => {
    const cancelled: DesktopResourceEvent = { type: "stream-complete", subscriptionId: "sub-1", status: "cancelled" };
    expect(applyResourceOperationEvent(base, cancelled).status).toBe("cancelled");
  });
});
