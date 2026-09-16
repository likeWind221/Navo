import type { ControlPurpose, NodeStatus } from "../../../node/model.js";

export type AgentRoadmapView = EmptyAgentRoadmapView | ReadyAgentRoadmapView;

export interface EmptyAgentRoadmapView {
  readonly state: "empty";
}

export interface ReadyAgentRoadmapView {
  readonly state: "ready";
  readonly version: number;
  readonly nodes: readonly AgentRoadmapNode[];
}

export type AgentRoadmapNode = AgentRoadmapWorkNode | AgentRoadmapControlNode;

interface AgentRoadmapNodeBase {
  readonly id: string;
  readonly title: string;
  readonly required: boolean;
  readonly status: NodeStatus;
  readonly depends_on: readonly string[];
}

export interface AgentRoadmapWorkNode extends AgentRoadmapNodeBase {
  readonly kind: "work";
  readonly task: string;
  readonly done_when: readonly string[];
}

export interface AgentRoadmapControlNode extends AgentRoadmapNodeBase {
  readonly kind: "control";
  readonly control: ControlPurpose;
}
