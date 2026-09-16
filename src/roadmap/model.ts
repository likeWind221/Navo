import type { NodeId, ProjectId } from "../brand/ids.js";

export interface RoadmapSnapshot { readonly revision: number; readonly graph: RoadmapGraph; }

export interface RoadmapGraph {
  readonly definition: RoadmapDefinition;
  readonly relations: readonly RoadmapRelations[];
  readonly topologicalOrder: readonly NodeId[];
}

export interface RoadmapDefinition {
  readonly projectId: ProjectId;
  readonly nodes: readonly NodeId[];
  readonly edges: readonly RoadmapEdge[];
}

export interface RoadmapEdge {
  readonly from: NodeId;
  readonly to: NodeId;
}

export interface RoadmapRelations {
  readonly nodeId: NodeId;
  readonly predecessors: readonly NodeId[];
  readonly successors: readonly NodeId[];
  readonly requiredBefore: readonly NodeId[];
}
