export const GRAPH_SCHEMA = `
CREATE TABLE graph_builds (
  build_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  source_asset_generation INTEGER NOT NULL CHECK (source_asset_generation >= 1),
  source_build_id TEXT NOT NULL REFERENCES resource_index_builds(build_id),
  pipeline_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('building', 'active', 'failed', 'superseded')),
  next_ordinal INTEGER NOT NULL CHECK (next_ordinal >= 0),
  error_code TEXT,
  UNIQUE (build_id, project_id)
) STRICT;
CREATE UNIQUE INDEX graph_building ON graph_builds(project_id, resource_id) WHERE status = 'building';
CREATE UNIQUE INDEX graph_active ON graph_builds(project_id, resource_id) WHERE status = 'active';
CREATE TABLE graph_entities (
  entity_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (project_id, type, name),
  UNIQUE (entity_id, project_id)
) STRICT;
CREATE TABLE graph_relations (
  relation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  FOREIGN KEY (source_id, project_id) REFERENCES graph_entities(entity_id, project_id),
  FOREIGN KEY (target_id, project_id) REFERENCES graph_entities(entity_id, project_id),
  UNIQUE (project_id, source_id, type, target_id),
  UNIQUE (relation_id, project_id)
) STRICT;
CREATE TABLE graph_evidence (
  project_id TEXT NOT NULL,
  build_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL REFERENCES resource_chunks(chunk_id),
  entity_id TEXT,
  relation_id TEXT,
  CHECK ((entity_id IS NULL) != (relation_id IS NULL)),
  FOREIGN KEY (build_id, project_id) REFERENCES graph_builds(build_id, project_id),
  FOREIGN KEY (entity_id, project_id) REFERENCES graph_entities(entity_id, project_id),
  FOREIGN KEY (relation_id, project_id) REFERENCES graph_relations(relation_id, project_id)
) STRICT;
CREATE UNIQUE INDEX graph_entity_evidence ON graph_evidence(build_id, chunk_id, entity_id) WHERE entity_id IS NOT NULL;
CREATE UNIQUE INDEX graph_relation_evidence ON graph_evidence(build_id, chunk_id, relation_id) WHERE relation_id IS NOT NULL;
CREATE INDEX graph_entity_sources ON graph_evidence(entity_id);
CREATE INDEX graph_relation_sources ON graph_evidence(relation_id);
`;
