import type { NodeId } from "../brand/ids.js";
import type { RoadmapChange } from "./events.js";
import { RoadmapError } from "./errors.js";
import type { RoadmapDefinition, RoadmapSnapshot } from "./model.js";

export function applyRoadmapChanges(current: RoadmapSnapshot, changes: readonly RoadmapChange[]): RoadmapDefinition {
  if (changes.length === 0) throw new RoadmapError("invalid-structure", "Changes must not be empty");
  let nodes = [...current.graph.definition.nodes];
  let edges = [...current.graph.definition.edges];
  const position = (id: NodeId): number => {
    const index = nodes.indexOf(id);
    if (index < 0) throw new RoadmapError("invalid-reference", `Node ${id} is not in the roadmap`);
    return index;
  };
  for (const change of changes) {
    switch (change.type) {
      case "insert": {
        if (nodes.includes(change.nodeId)) throw new RoadmapError("duplicate-reference", "Node is already in the roadmap");
        const index = change.index ?? nodes.length;
        if (!Number.isSafeInteger(index) || index < 0 || index > nodes.length) throw new RoadmapError("invalid-structure", "Invalid insertion position");
        nodes.splice(index, 0, change.nodeId);
        break;
      }
      case "connect": edges.push(change.edge); break;
      case "disconnect": {
        const index = edges.findIndex(edge => edge.from === change.edge.from && edge.to === change.edge.to);
        if (index < 0) throw new RoadmapError("invalid-reference", "Connection does not exist");
        edges.splice(index, 1);
        break;
      }
      case "reorder":
        if (change.nodeIds.length !== nodes.length || new Set(change.nodeIds).size !== nodes.length) throw new RoadmapError("invalid-structure", "Order must contain each node once");
        nodes = change.nodeIds.map(id => nodes[position(id)]!);
        break;
      case "remove":
        position(change.nodeId);
        nodes = nodes.filter(id => id !== change.nodeId);
        edges = edges.filter(edge => edge.from !== change.nodeId && edge.to !== change.nodeId);
        break;
      case "update-node":
        position(change.nodeId);
        break;
      default: throw new RoadmapError("invalid-structure", "Unknown roadmap change");
    }
  }
  return { projectId: current.graph.definition.projectId, nodes, edges };
}
