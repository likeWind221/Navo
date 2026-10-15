import type { NodeId } from "../brand/ids.js";
import { RoadmapError } from "./errors.js";
import type { RoadmapEvent } from "./events.js";
import type { RoadmapDefinition, RoadmapEdge } from "./model.js";

export function lastLegacyEvent(history: readonly RoadmapEvent[], legacy: ReadonlySet<string>): number {
  if (legacy.size === 0) return -1;
  try {
    return history.findLastIndex(event => references(event).some(id => legacy.has(id)));
  } catch {
    throw new RoadmapError("invalid-event-stream", "Invalid roadmap event");
  }
}

export function bypassLegacyNodes(definition: RoadmapDefinition, legacy: ReadonlySet<string>): RoadmapDefinition {
  if (!definition.nodes.some(id => legacy.has(id))) return definition;
  const successors = new Map<NodeId, NodeId[]>();
  for (const edge of definition.edges) successors.set(edge.from, [...successors.get(edge.from) ?? [], edge.to]);
  const edges: RoadmapEdge[] = [];
  for (const from of definition.nodes) {
    if (legacy.has(from)) continue;
    const visited = new Set<NodeId>();
    const pending = [...successors.get(from) ?? []];
    while (pending.length > 0) {
      const to = pending.shift()!;
      if (visited.has(to)) continue;
      visited.add(to);
      if (legacy.has(to)) {
        pending.push(...successors.get(to) ?? []);
        continue;
      }
      edges.push({ from, to });
    }
  }
  return { projectId: definition.projectId, nodes: definition.nodes.filter(id => !legacy.has(id)), edges };
}

function references(event: RoadmapEvent): readonly string[] {
  if (event.type === "roadmap-created") {
    return [...event.definition.nodes, ...event.definition.edges.flatMap(edge => [edge.from, edge.to])];
  }
  return event.type === "roadmap-changed" ? event.changes.flatMap(change => {
    switch (change.type) {
      case "connect":
      case "disconnect":
        return [change.edge.from, change.edge.to];
      case "reorder":
        return change.nodeIds;
      default:
        return [change.nodeId];
    }
  }) : [];
}
