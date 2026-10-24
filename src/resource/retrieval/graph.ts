import type { GraphSnapshot } from "../graph/read.js";
import type { RankedChunk, RelationPath } from "./types.js";

export function graphSearch(graph: GraphSnapshot, query: string, semanticHits: ReadonlySet<string>, maxHops: number,
  signal?: AbortSignal): readonly RankedChunk[] {
  const entities = new Map(graph.entities.map(entity => [entity.id, entity]));
  const direct = graph.entities.filter(entity => mentions(query, entity.name)).slice(0, 16);
  const semantic = new Map<string, GraphSnapshot["entities"][number]>();
  for (const chunkId of semanticHits) {
    for (const entity of graph.entities) {
      if (!direct.includes(entity) && entity.evidence.some(source => source.chunkId === chunkId)) semantic.set(entity.id, entity);
      if (semantic.size >= 10) break;
    }
    if (semantic.size >= 10) break;
  }
  const seeds = [...direct, ...semantic.values()];
  const adjacency = new Map<string, GraphSnapshot["relations"][number][]>();
  for (const relation of [...graph.relations].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!entities.has(relation.sourceId) || !entities.has(relation.targetId) || relation.evidence.length === 0) continue;
    for (const id of new Set([relation.sourceId, relation.targetId])) {
      const edges = adjacency.get(id) ?? [];
      edges.push(relation);
      adjacency.set(id, edges);
    }
  }
  const hits: RankedChunk[] = [];
  const queue = seeds.map(entity => ({ id: entity.id, seed: entity.id,
    path: { entities: [node(entity)], relations: [] } as RelationPath }));
  const visited = new Set(seeds.map(entity => JSON.stringify([entity.id, entity.id])));
  for (const entity of seeds) for (const source of entity.evidence.slice(0, 8)) {
    hits.push({ chunkId: source.chunkId, route: "entity", paths: [] });
  }
  let paths = 0;
  for (let index = 0; index < queue.length && paths < 100; index++) {
    signal?.throwIfAborted();
    const current = queue[index]!;
    if (current.path.relations.length >= maxHops) continue;
    for (const relation of adjacency.get(current.id) ?? []) {
      const outgoing = relation.sourceId === current.id;
      const next = outgoing ? relation.targetId : relation.sourceId;
      const key = JSON.stringify([current.seed, next]);
      if (visited.has(key)) continue;
      const path: RelationPath = { entities: [...current.path.entities, node(entities.get(next)!)],
        relations: [...current.path.relations, { ...relation, evidence: relation.evidence.slice(0, 8),
          direction: outgoing ? "outgoing" : "incoming" }] };
      visited.add(key);
      paths++;
      for (const source of relation.evidence.slice(0, 8)) hits.push({ chunkId: source.chunkId, route: "graph", paths: [path] });
      queue.push({ id: next, seed: current.seed, path });
      if (visited.size >= 64 || paths >= 100) break;
    }
    if (visited.size >= 64) break;
  }
  const candidates = new Set<string>();
  return hits.filter(hit => {
    if (candidates.has(hit.chunkId)) return true;
    if (candidates.size >= 40) return false;
    candidates.add(hit.chunkId);
    return true;
  });
}

function node(entity: GraphSnapshot["entities"][number]): RelationPath["entities"][number] {
  return { id: entity.id, name: entity.name, type: entity.type };
}

function mentions(query: string, name: string): boolean {
  const normalized = name.normalize("NFKC").toLowerCase();
  const text = query.normalize("NFKC").toLowerCase();
  if (/\p{Script=Han}/u.test(normalized)) return text.includes(normalized);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u").test(text);
}
