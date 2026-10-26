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

export function readGraph(ctx: Context, projectId: ProjectId, viewer: ResourcePrincipal, resourceIds?: readonly ResourceId[]): GraphSnapshot {
  return readGraphForResources(ctx, projectId, ctx.resources.listVisible(projectId, viewer), resourceIds);
}

export function readGraphForResources(ctx: Context, projectId: ProjectId,
  visible: readonly { readonly id: ResourceId; readonly assetGeneration: number }[], resourceIds?: readonly ResourceId[]): GraphSnapshot {
  const scope = resourceIds === undefined ? undefined : new Set(resourceIds);
  const resources = visible.filter(resource => scope === undefined || scope.has(resource.id));
  const generations = new Map(resources.map(resource => [resource.id as string, resource.assetGeneration]));
  const entities = new Map<string, { id: string; name: string; type: string; evidence: GraphSource[] }>();
  const relations = new Map<string, { id: string; sourceId: string; targetId: string; type: string; evidence: GraphSource[] }>();
  const addEntity = (id: string, name: string, type: string, source: GraphSource) => {
    const entity = entities.get(id) ?? { id, name, type, evidence: [] };
    if (!entity.evidence.some(existing => existing.chunkId === source.chunkId)) entity.evidence.push(source);
    entities.set(id, entity);
  };
  const ids = [...generations.keys()];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const rows = ctx.storage.atomic(tx => tx.readGraphEvidence(projectId, ids.slice(offset, offset + 200)));
    for (const row of rows) {
      if (generations.get(row.resource_id) !== row.source_asset_generation) continue;
      const evidence: GraphSource = { resourceId: row.resource_id as ResourceId,
        assetGeneration: row.source_asset_generation, chunkId: row.chunk_id };
      if (row.entity_id !== null) {
        addEntity(row.entity_id, row.name!, row.entity_type!, evidence);
      } else {
        addEntity(row.source_id!, row.source_name!, row.source_type!, evidence);
        addEntity(row.target_id!, row.target_name!, row.target_type!, evidence);
        const relation = relations.get(row.relation_id!) ?? { id: row.relation_id!, sourceId: row.source_id!, targetId: row.target_id!,
          type: row.relation_type!, evidence: [] };
        relation.evidence.push(evidence);
        relations.set(relation.id, relation);
      }
    }
  }
  return { entities: [...entities.values()], relations: [...relations.values()] };
}
