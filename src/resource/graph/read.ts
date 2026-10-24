import type { Context } from "cordis";
import type { ProjectId, ResourceId } from "../../brand/ids.js";
import type { ResourcePrincipal } from "../model.js";

export interface GraphSnapshot {
  readonly entities: readonly { readonly id: string; readonly name: string; readonly type: string; readonly evidence: readonly GraphSource[] }[];
  readonly relations: readonly { readonly id: string; readonly sourceId: string; readonly targetId: string; readonly type: string;
    readonly evidence: readonly GraphSource[] }[];
}

export interface GraphSource {
  readonly resourceId: ResourceId;
  readonly assetGeneration: number;
  readonly chunkId: string;
}

export function readGraph(ctx: Context, projectId: ProjectId, viewer: ResourcePrincipal): GraphSnapshot {
  const resources = ctx.resources.listVisible(projectId, viewer);
  const generations = new Map(resources.map(resource => [resource.id as string, resource.assetGeneration]));
  const entities = new Map<string, { id: string; name: string; type: string; evidence: GraphSource[] }>();
  const relations = new Map<string, { id: string; sourceId: string; targetId: string; type: string; evidence: GraphSource[] }>();
  const ids = [...generations.keys()];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const rows = ctx.storage.atomic(tx => tx.readGraphEvidence(projectId, ids.slice(offset, offset + 200)));
    for (const row of rows) {
      if (generations.get(row.resource_id) !== row.source_asset_generation) continue;
      const evidence: GraphSource = { resourceId: row.resource_id as ResourceId,
        assetGeneration: row.source_asset_generation, chunkId: row.chunk_id };
      if (row.entity_id !== null) {
        const entity = entities.get(row.entity_id) ?? { id: row.entity_id, name: row.name!, type: row.entity_type!, evidence: [] };
        entity.evidence.push(evidence);
        entities.set(entity.id, entity);
      } else {
        const relation = relations.get(row.relation_id!) ?? { id: row.relation_id!, sourceId: row.source_id!, targetId: row.target_id!,
          type: row.relation_type!, evidence: [] };
        relation.evidence.push(evidence);
        relations.set(relation.id, relation);
      }
    }
  }
  return { entities: [...entities.values()], relations: [...relations.values()] };
}
