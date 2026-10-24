import type { DatabaseSync } from "node:sqlite";
import type { GraphBuildRecord, GraphEvidenceRecord, GraphTransaction } from "../graph.js";
import { removeFacts, writeFacts } from "./facts.js";

export function graphTransaction(db: DatabaseSync): GraphTransaction {
  const readBuild = (id: string) => db.prepare("SELECT * FROM graph_builds WHERE build_id = ?").get(id) as unknown as GraphBuildRecord | undefined;
  const current = (build: GraphBuildRecord) => db.prepare(`SELECT 1 FROM resource_index_builds i JOIN resource_content c
    ON c.project_id = i.project_id AND c.resource_id = i.resource_id
    WHERE i.build_id = ? AND i.project_id = ? AND i.resource_id = ? AND i.status = 'active'
    AND i.source_asset_generation = ? AND c.source_asset_generation = i.source_asset_generation AND c.status = 'ready'`)
    .get(build.source_build_id, build.project_id, build.resource_id, build.source_asset_generation) !== undefined;
  const supersede = (id: string) => {
    db.prepare("UPDATE graph_builds SET status = 'superseded' WHERE build_id = ?").run(id);
    removeFacts(db, id);
  };
  return {
    listGraphBuilds() {
      return db.prepare("SELECT * FROM graph_builds ORDER BY rowid").all() as unknown as GraphBuildRecord[];
    },
    createGraphBuild(build) {
      if (!current(build)) throw new Error("Graph source is no longer current.");
      db.prepare("INSERT INTO graph_builds VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(build.build_id, build.project_id, build.resource_id, build.source_asset_generation, build.source_build_id,
          build.pipeline_version, build.status, build.next_ordinal, build.error_code);
    },
    writeGraphBatch(buildId, start, end, graph) {
      const build = readBuild(buildId);
      if (build?.status !== "building" || build.next_ordinal !== start || !current(build)) return false;
      const chunks = db.prepare("SELECT chunk_id FROM resource_chunks WHERE build_id = ? AND ordinal >= ? AND ordinal < ? ORDER BY ordinal")
        .all(build.source_build_id, start, end);
      if (end <= start || chunks.length !== end - start) return false;
      const allowed = new Set(chunks.map(chunk => chunk.chunk_id));
      const ids = new Set(graph.entities.map(entity => entity.id));
      if (graph.entities.some(entity => entity.chunkIds.some(id => !allowed.has(id)))
        || graph.relations.some(relation => !allowed.has(relation.chunkId) || !ids.has(relation.source) || !ids.has(relation.target))) return false;
      writeFacts(db, build, graph);
      db.prepare("UPDATE graph_builds SET next_ordinal = ? WHERE build_id = ?").run(end, buildId);
      return true;
    },
    publishGraphBuild(buildId) {
      const build = readBuild(buildId);
      if (build?.status !== "building" || !current(build)) return false;
      const source = db.prepare("SELECT expected_chunk_count FROM resource_index_builds WHERE build_id = ?").get(build.source_build_id)!;
      if (source.expected_chunk_count !== build.next_ordinal) return false;
      const previous = db.prepare("SELECT build_id FROM graph_builds WHERE project_id = ? AND resource_id = ? AND status = 'active'")
        .all(build.project_id, build.resource_id);
      for (const row of previous) supersede(row.build_id as string);
      db.prepare("UPDATE graph_builds SET status = 'active', error_code = NULL WHERE build_id = ?").run(buildId);
      return true;
    },
    failGraphBuild(buildId, code) {
      db.prepare("UPDATE graph_builds SET status = 'failed', error_code = ? WHERE build_id = ? AND status = 'building'").run(code, buildId);
    },
    resumeGraphBuild(buildId) {
      db.prepare("UPDATE graph_builds SET status = 'building', error_code = NULL WHERE build_id = ? AND status = 'failed'").run(buildId);
    },
    supersedeGraphBuild: supersede,
    readGraphEvidence(projectId, resourceIds) {
      if (resourceIds.length === 0) return [];
      return db.prepare(`SELECT b.resource_id, b.source_asset_generation, e.chunk_id, e.entity_id, e.relation_id,
        n.name, n.type AS entity_type, r.source_id, r.target_id, r.type AS relation_type
        FROM graph_evidence e JOIN graph_builds b ON b.build_id = e.build_id
        JOIN resource_index_builds i ON i.build_id = b.source_build_id
        JOIN resource_content c ON c.project_id = b.project_id AND c.resource_id = b.resource_id
        LEFT JOIN graph_entities n ON n.entity_id = e.entity_id
        LEFT JOIN graph_relations r ON r.relation_id = e.relation_id
        WHERE b.project_id = ? AND b.resource_id IN (${resourceIds.map(() => "?").join(",")}) AND b.status = 'active'
        AND i.status = 'active' AND c.status = 'ready' AND c.source_asset_generation = b.source_asset_generation
        ORDER BY e.rowid`).all(projectId, ...resourceIds) as unknown as GraphEvidenceRecord[];
    },
  };
}
