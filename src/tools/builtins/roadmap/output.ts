import type { JsonObject, JsonValue } from "../../../llm/types.js";
import type { NodeSnapshot } from "../../../node/model.js";
import type { RoadmapSnapshot } from "../../../roadmap/model.js";
import type {
  AgentNodeView,
  AgentRoadmapNode,
  AgentRoadmapView,
  EmptyAgentRoadmapView,
  ReadyAgentRoadmapView,
} from "./types.js";

export function emptyAgentRoadmapView(): EmptyAgentRoadmapView {
  return Object.freeze({ state: "empty" });
}

export function createAgentRoadmapView(
  roadmap: RoadmapSnapshot,
  nodes: readonly NodeSnapshot[],
): ReadyAgentRoadmapView {
  const byId = new Map(nodes.map((snapshot) => [snapshot.node.id, snapshot]));
  const relations = new Map(roadmap.graph.relations.map((relation) => [relation.nodeId, relation]));
  const projected = roadmap.graph.topologicalOrder.map((nodeId): AgentRoadmapNode => {
    const snapshot = byId.get(nodeId);
    const relation = relations.get(nodeId);
    if (!snapshot || !relation) {
      throw new Error(`Roadmap Node '${nodeId}' is missing from the projected state.`);
    }
    return Object.freeze({
      id: String(snapshot.node.id),
      ...nodeContent(snapshot),
      depends_on: Object.freeze(relation.predecessors.map(String)),
    });
  });
  return Object.freeze({
    state: "ready",
    version: roadmap.revision,
    nodes: Object.freeze(projected),
  });
}

export function createAgentNodeView(snapshot: NodeSnapshot): AgentNodeView {
  return Object.freeze({ id: String(snapshot.node.id), version: snapshot.revision, ...nodeContent(snapshot) });
}

function nodeContent(snapshot: NodeSnapshot) {
  return {
    title: snapshot.node.objective.title,
    required: snapshot.node.requirement === "required",
    status: snapshot.status,
    goal: snapshot.node.objective.description,
    done_when: Object.freeze([...snapshot.node.objective.acceptanceCriteria]),
  } as const;
}

export function formatAgentRoadmapView(view: AgentRoadmapView): string {
  if (view.state === "empty") {
    return "Roadmap is empty.\nNo roadmap has been created for this Project.";
  }

  const lines = [`Roadmap version: ${view.version}`, "", "Dependencies:"];
  const dependencies = view.nodes.flatMap((node) =>
    node.depends_on.map((dependency) => `${dependency} -> ${node.id}`));
  lines.push(...(dependencies.length > 0 ? dependencies : ["none"]), "", "Nodes:");

  for (const node of view.nodes) {
    lines.push(
      "",
      `[${node.id}] ${inline(node.title)}`,
      `required: ${node.required ? "yes" : "no"}`,
      `status: ${node.status}`,
      `depends_on: ${node.depends_on.length > 0 ? node.depends_on.join(", ") : "none"}`,
      `Goal: ${inline(node.goal)}`,
      "Done when:",
      ...criteria(node.done_when),
    );
  }

  return lines.join("\n");
}

export function formatAgentNodeView(view: AgentNodeView): string {
  const lines = [
    `Node: ${view.id}`,
    `version: ${view.version}`,
    `title: ${inline(view.title)}`,
    `required: ${view.required ? "yes" : "no"}`,
    `status: ${view.status}`,
    `Goal: ${inline(view.goal)}`,
    "Done when:",
    ...criteria(view.done_when),
  ];
  return lines.join("\n");
}

export function agentRoadmapArtifact(view: AgentRoadmapView): JsonObject {
  if (view.state === "empty") return { state: "empty" };
  const nodes: JsonValue[] = view.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    required: node.required,
    status: node.status,
    depends_on: [...node.depends_on],
    goal: node.goal,
    done_when: [...node.done_when],
  }));
  return { state: "ready", version: view.version, nodes };
}

export function agentNodeArtifact(view: AgentNodeView): JsonObject {
  return {
    id: view.id,
    version: view.version,
    title: view.title,
    required: view.required,
    status: view.status,
    goal: view.goal,
    done_when: [...view.done_when],
  };
}

function criteria(values: readonly string[]): string[] {
  return values.length > 0 ? values.map((criterion) => `- ${inline(criterion)}`) : ["- none"];
}

function inline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
