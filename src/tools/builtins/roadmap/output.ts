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
    const base = {
      id: String(snapshot.node.id),
      title: snapshot.node.kind === "work" ? snapshot.node.objective.title : snapshot.node.title,
      required: snapshot.node.requirement === "required",
      status: snapshot.status,
      depends_on: Object.freeze(relation.predecessors.map(String)),
    } as const;
    if (snapshot.node.kind === "control") {
      return Object.freeze({
        ...base,
        kind: "control" as const,
        control: snapshot.node.purpose,
      });
    }
    return Object.freeze({
      ...base,
      kind: "work" as const,
      goal: snapshot.node.objective.description,
      done_when: Object.freeze([...snapshot.node.objective.acceptanceCriteria]),
    });
  });
  return Object.freeze({
    state: "ready",
    version: roadmap.revision,
    nodes: Object.freeze(projected),
  });
}

export function createAgentNodeView(snapshot: NodeSnapshot): AgentNodeView {
  const base = {
    id: String(snapshot.node.id),
    version: snapshot.revision,
    title: snapshot.node.kind === "work" ? snapshot.node.objective.title : snapshot.node.title,
    required: snapshot.node.requirement === "required",
    status: snapshot.status,
  } as const;
  if (snapshot.node.kind === "control") {
    return Object.freeze({
      ...base,
      kind: "control" as const,
      control: snapshot.node.purpose,
    });
  }
  return Object.freeze({
    ...base,
    kind: "work" as const,
    goal: snapshot.node.objective.description,
    done_when: Object.freeze([...snapshot.node.objective.acceptanceCriteria]),
  });
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
    );
    if (node.kind === "control") {
      lines.push(`Control: ${node.control}`);
      continue;
    }
    lines.push(`Goal: ${inline(node.goal)}`, "Done when:");
    lines.push(...(node.done_when.length > 0
      ? node.done_when.map((criterion) => `- ${inline(criterion)}`)
      : ["- none"]));
  }

  return lines.join("\n");
}

export function formatAgentNodeView(view: AgentNodeView): string {
  const lines = [
    `Node: ${view.id}`,
    `version: ${view.version}`,
    `title: ${inline(view.title)}`,
    `kind: ${view.kind}`,
    `required: ${view.required ? "yes" : "no"}`,
    `status: ${view.status}`,
  ];
  if (view.kind === "control") {
    lines.push(`Control: ${view.control}`);
  } else {
    lines.push(`Goal: ${inline(view.goal)}`, "Done when:");
    lines.push(...(view.done_when.length > 0
      ? view.done_when.map((criterion) => `- ${inline(criterion)}`)
      : ["- none"]));
  }
  return lines.join("\n");
}

export function agentRoadmapArtifact(view: AgentRoadmapView): JsonObject {
  if (view.state === "empty") return { state: "empty" };
  const nodes: JsonValue[] = view.nodes.map((node) => {
    const base: JsonObject = {
      id: node.id,
      title: node.title,
      required: node.required,
      status: node.status,
      depends_on: [...node.depends_on],
    };
    return node.kind === "control"
      ? { ...base, kind: "control", control: node.control }
      : {
          ...base,
          kind: "work",
          goal: node.goal,
          done_when: [...node.done_when],
        };
  });
  return { state: "ready", version: view.version, nodes };
}

export function agentNodeArtifact(view: AgentNodeView): JsonObject {
  const base: JsonObject = {
    id: view.id,
    version: view.version,
    title: view.title,
    kind: view.kind,
    required: view.required,
    status: view.status,
  };
  return view.kind === "control"
    ? { ...base, control: view.control }
    : { ...base, goal: view.goal, done_when: [...view.done_when] };
}

function inline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
