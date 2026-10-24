import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { GraphBuildRecord, GraphExtraction } from "../graph.js";

export function writeFacts(db: DatabaseSync, build: GraphBuildRecord, graph: GraphExtraction): void {
  const entities = new Map<string, string>();
  const insertEntity = db.prepare("INSERT INTO graph_entities VALUES (?, ?, ?, ?) ON CONFLICT(project_id, type, name) DO NOTHING");
  const entityId = db.prepare("SELECT entity_id FROM graph_entities WHERE project_id = ? AND type = ? AND name = ?");
  const evidence = db.prepare("INSERT OR IGNORE INTO graph_evidence VALUES (?, ?, ?, ?, ?)");
  for (const entity of graph.entities) {
    insertEntity.run(randomUUID(), build.project_id, entity.type, entity.name);
    const id = entityId.get(build.project_id, entity.type, entity.name)!.entity_id as string;
    entities.set(entity.id, id);
    for (const chunkId of entity.chunkIds) evidence.run(build.project_id, build.build_id, chunkId, id, null);
  }
  const insertRelation = db.prepare("INSERT INTO graph_relations VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, source_id, type, target_id) DO NOTHING");
  const relationId = db.prepare("SELECT relation_id FROM graph_relations WHERE project_id = ? AND source_id = ? AND type = ? AND target_id = ?");
  for (const relation of graph.relations) {
    const source = entities.get(relation.source)!;
    const target = entities.get(relation.target)!;
    insertRelation.run(randomUUID(), build.project_id, source, relation.type, target);
    const id = relationId.get(build.project_id, source, relation.type, target)!.relation_id as string;
    evidence.run(build.project_id, build.build_id, relation.chunkId, null, id);
    evidence.run(build.project_id, build.build_id, relation.chunkId, source, null);
    evidence.run(build.project_id, build.build_id, relation.chunkId, target, null);
  }
}

export function removeFacts(db: DatabaseSync, buildId: string): void {
  db.prepare("DELETE FROM graph_evidence WHERE build_id = ?").run(buildId);
  db.exec(`DELETE FROM graph_relations WHERE NOT EXISTS (
    SELECT 1 FROM graph_evidence e WHERE e.relation_id = graph_relations.relation_id);
    DELETE FROM graph_entities WHERE NOT EXISTS (SELECT 1 FROM graph_evidence e WHERE e.entity_id = graph_entities.entity_id)
    AND NOT EXISTS (SELECT 1 FROM graph_relations r WHERE r.source_id = graph_entities.entity_id OR r.target_id = graph_entities.entity_id);`);
}
