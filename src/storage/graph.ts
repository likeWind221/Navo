export interface GraphTransaction {
  listGraphBuilds(): readonly GraphBuildRecord[];
  createGraphBuild(build: GraphBuildRecord): void;
  writeGraphBatch(buildId: string, start: number, end: number, graph: GraphExtraction): boolean;
  publishGraphBuild(buildId: string): boolean;
  failGraphBuild(buildId: string, code: string): void;
  resumeGraphBuild(buildId: string): void;
  supersedeGraphBuild(buildId: string): void;
  readGraphEvidence(projectId: string, resourceIds: readonly string[]): readonly GraphEvidenceRecord[];
}

export interface GraphBuildRecord {
  readonly build_id: string;
  readonly project_id: string;
  readonly resource_id: string;
  readonly source_asset_generation: number;
  readonly source_build_id: string;
  readonly pipeline_version: string;
  readonly status: "building" | "active" | "failed" | "superseded";
  readonly next_ordinal: number;
  readonly error_code: string | null;
}

export interface GraphExtraction {
  readonly entities: readonly ExtractedEntity[];
  readonly relations: readonly ExtractedRelation[];
}

export interface ExtractedEntity {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly chunkIds: readonly string[];
}

export interface ExtractedRelation {
  readonly source: string;
  readonly target: string;
  readonly type: string;
  readonly chunkId: string;
}

export interface GraphEvidenceRecord {
  readonly resource_id: string;
  readonly source_asset_generation: number;
  readonly chunk_id: string;
  readonly entity_id: string | null;
  readonly relation_id: string | null;
  readonly name: string | null;
  readonly entity_type: string | null;
  readonly source_id: string | null;
  readonly target_id: string | null;
  readonly relation_type: string | null;
}
