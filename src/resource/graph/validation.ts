import type { JsonObject, ToolSchema } from "../../llm/types.js";
import type { ExtractedEntity, ExtractedRelation, GraphExtraction } from "../../storage/graph.js";
import { GraphError } from "./errors.js";

export const GRAPH_TOOL: ToolSchema = {
  name: "extract_graph",
  description: "Return entities and directed relationships grounded in the supplied chunks. IDs are local to this batch.",
  parameters: object({
    entities: { type: "array", maxItems: 256, items: object({
      id: string(128), name: string(512), type: string(128),
      chunkIds: { type: "array", maxItems: 64, items: string(256) },
    }) },
    relations: { type: "array", maxItems: 512, items: object({
      source: string(128), target: string(128), type: string(128), chunkId: string(256),
    }) },
  }),
};

export function validateGraph(value: unknown, chunkIds: ReadonlySet<string>): GraphExtraction {
  record(value, ["entities", "relations"]);
  array(value.entities, 256);
  array(value.relations, 512);
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();
  for (const entity of value.entities) {
    record(entity, ["id", "name", "type", "chunkIds"]);
    text(entity.id, 128); text(entity.name, 512); text(entity.type, 128); array(entity.chunkIds, 64);
    for (const id of entity.chunkIds) text(id, 256);
    if (seen.has(entity.id)) invalid("Duplicate entity ID.");
    seen.add(entity.id);
    const name = normalizeName(entity.name);
    const type = normalizeName(entity.type);
    if (!entity.id.trim() || !name || !type) continue;
    entities.push({ id: entity.id, name, type, chunkIds: [...new Set(entity.chunkIds as string[])].filter(id => chunkIds.has(id)) });
  }
  const ids = new Set(entities.map(entity => entity.id));
  const relations: ExtractedRelation[] = [];
  for (const relation of value.relations) {
    record(relation, ["source", "target", "type", "chunkId"]);
    text(relation.source, 128); text(relation.target, 128); text(relation.type, 128); text(relation.chunkId, 256);
    const type = normalizeName(relation.type);
    if (!type || !ids.has(relation.source) || !ids.has(relation.target) || !chunkIds.has(relation.chunkId)) continue;
    relations.push({ source: relation.source, target: relation.target, type, chunkId: relation.chunkId });
  }
  const endpoints = new Set(relations.flatMap(relation => [relation.source, relation.target]));
  return { entities: entities.filter(entity => entity.chunkIds.length > 0 || endpoints.has(entity.id)), relations };
}

export function normalizeName(value: string): string { return value.normalize("NFC").trim().replace(/\s+/gu, " "); }

function object(properties: Record<string, JsonObject>): JsonObject {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
function string(maxLength: number): JsonObject { return { type: "string", maxLength }; }
function record(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) invalid("Invalid graph object fields.");
}
function array(value: unknown, limit: number): asserts value is unknown[] {
  if (!Array.isArray(value)) invalid("Expected a graph array.");
  if (value.length > limit) throw new GraphError("output-limit", "Graph array exceeds its item limit.");
}
function text(value: unknown, limit: number): asserts value is string {
  if (typeof value !== "string" || value.length > limit) invalid("Invalid graph string field.");
}
function invalid(message: string): never { throw new GraphError("invalid-output", message); }
