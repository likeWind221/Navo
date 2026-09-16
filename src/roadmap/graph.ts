import type { NodeId } from "../brand/ids.js";
import type { Node } from "../node/model.js";
import { RoadmapError } from "./errors.js";
import type { RoadmapDefinition, RoadmapGraph } from "./model.js";

export function buildRoadmapGraph(
  input: RoadmapDefinition,
  catalog: readonly Pick<Node, "id" | "projectId" | "requirement">[],
): RoadmapGraph {
  const fail = (code: RoadmapError["code"], message: string): never => {
    throw new RoadmapError(code, message);
  };
  if (typeof input.projectId !== "string" || !input.projectId.trim()) {
    fail("invalid-structure", "Project identity must not be empty");
  }
  const ids = [...input.nodes];
  const nodes = new Set(ids);
  if (nodes.size !== input.nodes.length) {
    fail("duplicate-reference", "Roadmap contains duplicate nodes");
  }
  const owners = new Map<NodeId, typeof catalog[number]>();
  for (const node of catalog) {
    if (!nodes.has(node.id)) continue;
    if (owners.has(node.id)) fail("duplicate-reference", `Duplicate catalog node ${node.id}`);
    owners.set(node.id, node);
  }
  for (const id of nodes) {
    if (typeof id !== "string" || !id.trim() || owners.get(id)?.projectId !== input.projectId) {
      fail("invalid-reference", `Node ${id} must exist in this project`);
    }
  }
  const reference = (id: NodeId): void => {
    if (!nodes.has(id)) fail("invalid-reference", `Unknown roadmap node ${id}`);
  };
  const predecessors = new Map(ids.map(id => [id, new Set<NodeId>()]));
  const successors = new Map(ids.map(id => [id, new Set<NodeId>()]));
  const required = new Map(ids.map(id => [id, new Set<NodeId>()]));
  const connect = (from: NodeId, to: NodeId): void => {
    reference(from);
    reference(to);
    if (from === to) fail("cycle", `Self connection at ${from}`);
    if (successors.get(from)!.has(to)) {
      fail("duplicate-reference", `Duplicate connection ${from} -> ${to}`);
    }
    successors.get(from)!.add(to);
    predecessors.get(to)!.add(from);
  };
  for (const edge of input.edges) {
    connect(edge.from, edge.to);
  }
  const degree = new Map(ids.map(id => [id, predecessors.get(id)!.size]));
  const queue = ids.filter(id => degree.get(id) === 0);
  const order: NodeId[] = [];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor]!;
    order.push(id);
    for (const next of successors.get(id)!) {
      const remaining = degree.get(next)! - 1;
      degree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  if (order.length !== nodes.size) fail("cycle", "Roadmap contains a structural cycle; loops need explicit rounds");
  for (const id of order) {
    for (const next of successors.get(id)!) {
      for (const ancestor of required.get(id)!) required.get(next)!.add(ancestor);
      if (catalog.find(node => node.id === id)?.requirement === "required") required.get(next)!.add(id);
    }
  }
  const definition: RoadmapDefinition = Object.freeze({
    projectId: input.projectId,
    nodes: Object.freeze([...input.nodes]),
    edges: Object.freeze(input.edges.map(edge => Object.freeze({ from: edge.from, to: edge.to }))),
  });
  return Object.freeze({
    definition,
    topologicalOrder: Object.freeze(order),
    relations: Object.freeze(ids.map(nodeId => Object.freeze({
      nodeId,
      predecessors: Object.freeze([...predecessors.get(nodeId)!]),
      successors: Object.freeze([...successors.get(nodeId)!]),
      requiredBefore: Object.freeze([...required.get(nodeId)!]),
    }))),
  });
}
