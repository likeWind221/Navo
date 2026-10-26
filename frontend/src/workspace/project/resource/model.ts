import type { ResourceLibraryItemV1, ResourceLibrarySnapshotV1 } from "../../../../../rpc/resource.js";
import type { DesktopResourceFailure } from "../../../../shared/resource.js";

export type ResourceLibraryStatus = "loading" | "ready" | "failed";

export interface ResourceLibraryState {
  readonly projectId: string;
  readonly path: string | null;
  readonly snapshot: ResourceLibrarySnapshotV1 | null;
  readonly status: ResourceLibraryStatus;
  readonly failure: DesktopResourceFailure | null;
  readonly selected: ResourceLibraryItemV1 | null;
}

export function parentPath(path: string | null): string | null {
  if (path === null) return null;
  const separator = path.lastIndexOf("/");
  return separator < 0 ? null : path.slice(0, separator);
}

export function resourceStatus(item: ResourceLibraryItemV1): { readonly label: string; readonly tone: "ready" | "working" | "failed" | "neutral" } {
  if (item.content === null) return { label: "尚未处理", tone: "neutral" };
  switch (item.content.status) {
    case "ready": return { label: "正文就绪", tone: "ready" };
    case "pending": return { label: "等待处理", tone: "working" };
    case "processing": return { label: "处理中", tone: "working" };
    case "metadata_only": return { label: "仅元数据", tone: "neutral" };
    case "failed": return { label: "处理失败", tone: "failed" };
  }
}

export function ownerLabel(item: ResourceLibraryItemV1): string {
  if (item.owner.kind === "user") return "用户";
  if (item.owner.kind === "main") return "Main";
  return `Node ${item.owner.nodeId}`;
}
