import type { EventId, NodeId, ProjectId } from "../brand/ids.js";
import type { RoadmapDefinition, RoadmapEdge } from "./model.js";

export type RoadmapEvent = RoadmapEventHeader & (
  | { readonly type: "roadmap-created"; readonly definition: RoadmapDefinition }
  | { readonly type: "roadmap-changed"; readonly changes: readonly RoadmapChange[] }
);

export type RoadmapChange =
  | { readonly type: "insert"; readonly nodeId: NodeId; readonly index?: number }
  | { readonly type: "connect" | "disconnect"; readonly edge: RoadmapEdge }
  | { readonly type: "reorder"; readonly nodeIds: readonly NodeId[] }
  | { readonly type: "remove"; readonly nodeId: NodeId };

interface RoadmapEventHeader {
  readonly version: 1;
  readonly id: EventId;
  readonly projectId: ProjectId;
  readonly revision: number;
  readonly baseRevision: number;
  readonly timestamp: string;
  readonly reason: string;
}

export function freezeRoadmapEvent(event: RoadmapEvent): RoadmapEvent {
  const copy = structuredClone(event);
  function freeze(value: unknown): void {
    if (value === null || typeof value !== "object") return;
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  freeze(copy);
  return copy;
}
