import { describe, expect, it } from "vitest";
import { createNodeId, createProjectId } from "../../src/brand/ids.js";
import type { NodeId } from "../../src/brand/ids.js";
import { buildRoadmapGraph } from "../../src/roadmap/graph.js";
import type { RoadmapDefinition, RoadmapGraph } from "../../src/roadmap/model.js";

const projectId = createProjectId("project");
const ids = ["a", "b", "c", "d", "e", "f"].map(createNodeId);
const [a, b, c, d, e, f] = ids;
const catalog = ids.map((id, index) => ({ id, projectId, requirement: index === 1 ? "optional" as const : "required" as const }));
const definition: RoadmapDefinition = { projectId, nodes: ids, edges: [
  { from: a!, to: b! }, { from: b!, to: c! }, { from: c!, to: f! },
  { from: a!, to: d! }, { from: d!, to: e! }, { from: e!, to: f! },
] };

function relation(graph: RoadmapGraph, id: NodeId) { return graph.relations.find(row => row.nodeId === id)!; }

describe("roadmap graph", () => {
  it("represents branching and joining with node ids and edges", () => {
    const graph = buildRoadmapGraph(definition, catalog);
    expect(relation(graph, a!).successors).toEqual([b, d]);
    expect(relation(graph, f!).predecessors).toEqual([c, e]);
    expect(new Set(relation(graph, f!).requiredBefore)).toEqual(new Set([a, c, d, e]));
    expect(graph.topologicalOrder).toEqual([a, b, d, c, e, f]);
  });

  it("propagates required ancestors across optional nodes", () => {
    const allOptional = catalog.map(node => ({ ...node, requirement: "optional" as const }));
    const graph = buildRoadmapGraph(definition, allOptional);
    expect(graph.relations.every(row => row.requiredBefore.length === 0)).toBe(true);
    expect(relation(buildRoadmapGraph(definition, catalog), c!).requiredBefore).toEqual([a]);
  });

  it("keeps display order independent from topology and freezes output", () => {
    const graph = buildRoadmapGraph({ ...definition, nodes: [...ids].reverse() }, catalog);
    expect(graph.definition.nodes[0]).toBe(f);
    expect(graph.topologicalOrder[0]).toBe(a);
    expect(Object.isFrozen(graph.definition)).toBe(true);
    expect(Object.isFrozen(graph.relations[0])).toBe(true);
  });

  it.each([
    [{ ...definition, nodes: [a!, a!] }, "duplicate-reference"],
    [{ ...definition, edges: [{ from: a!, to: a! }] }, "cycle"],
    [{ ...definition, edges: [{ from: a!, to: b! }, { from: b!, to: a! }] }, "cycle"],
    [{ ...definition, edges: [{ from: a!, to: createNodeId("missing") }] }, "invalid-reference"],
  ])("rejects malformed graph", (input, code) => {
    expect(() => buildRoadmapGraph(input as RoadmapDefinition, catalog)).toThrow(expect.objectContaining({ code }));
  });
});
