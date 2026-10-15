import type { NodeStatus } from "../../../node/model.js";

export type AgentRoadmapView = EmptyAgentRoadmapView | ReadyAgentRoadmapView;

export interface EmptyAgentRoadmapView {
  readonly state: "empty";
}

export interface ReadyAgentRoadmapView {
  readonly state: "ready";
  readonly version: number;
  readonly nodes: readonly AgentRoadmapNode[];
}

export interface AgentRoadmapNode extends AgentNodeContent {
  readonly id: string;
  readonly depends_on: readonly string[];
}

export interface AgentNodeView extends AgentNodeContent {
  readonly id: string;
  readonly version: number;
}

interface AgentNodeContent {
  readonly title: string;
  readonly required: boolean;
  readonly status: NodeStatus;
  readonly goal: string;
  readonly done_when: readonly string[];
}
