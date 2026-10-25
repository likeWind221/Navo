import type { Context } from "cordis";

import type { JsonObject } from "../../../llm/types.js";
import { ResourceIndexError } from "../../../resource/index/errors.js";
import type { RelationPath } from "../../../resource/retrieval/types.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";
import {
  invalidResourceTool,
  requireResourceToolCaller,
  resourceToolFailure,
  resourceToolFolder,
  resourceToolLimit,
} from "./common.js";

export const SEARCH_RESOURCES_TOOL_NAME = "search_resources";

const schema: JsonObject = {
  type: "object",
  properties: {
    query: { type: "string", description: "Topic or evidence to find, 1–4096 characters; must not be blank." },
    top_k: { type: "integer", description: "Global snippet budget, default 10, from 1 through 100; at most three snippets per Resource." },
    folder: { type: "string", description: "Optional logical library folder, including descendants; empty means all folders." },
  },
  required: ["query"],
  additionalProperties: false,
};

export function createSearchResourcesTool(ctx: Context): ToolDefinition {
  return {
    name: SEARCH_RESOURCES_TOOL_NAME,
    description: "Find a topic or evidence in visible Resources using existing hybrid semantic and relationship retrieval. Returns original snippets, locations, match types and available relationship evidence. Empty results mean no matches; retrieval failures are errors. Use fetch_resource with a returned Resource ID for original text or more context. No discovery step is required when known information is sufficient or a valid Resource ID is already known.",
    parameters: schema,
    async execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const caller = requireResourceToolCaller(ctx, execution.sessionId);
        const query = arguments_.query;
        if (typeof query !== "string" || !query.trim() || query.length > 4096) {
          throw invalidResourceTool("query must contain 1–4096 characters and must not be blank.");
        }
        const topK = resourceToolLimit(arguments_.top_k, 10, "top_k");
        const folder = resourceToolFolder(arguments_.folder);
        const hits = await ctx.retrieval.search({
          projectId: caller.projectId, viewer: caller.principal, query, topK,
          ...(folder === undefined ? {} : { folder }), signal: execution.signal,
        });
        execution.signal.throwIfAborted();
        const resources = hits.map(hit => ({
          resource_id: String(hit.resourceId), name: hit.name, libraryPath: hit.libraryPath,
          assetGeneration: hit.assetGeneration,
          snippets: hit.chunks.map(chunk => ({
            chunkId: chunk.chunkId, text: chunk.text, headingPath: [...chunk.headingPath], pages: [...chunk.pages],
            rank: chunk.rank, matches: [...chunk.matches], paths: chunk.paths.map(relationPath),
          })),
        }));
        const result = { status: resources.length === 0 ? "empty" : "found", resources };
        return { content: JSON.stringify(result), artifact: result };
      } catch (error: unknown) {
        if (error instanceof ResourceIndexError) {
          throw new ToolExecutionError(error.message, `Resource search failed (${error.code}).`, { cause: error });
        }
        return resourceToolFailure(error);
      }
    },
  };
}

function relationPath(path: RelationPath) {
  return {
    entities: path.entities.map(entity => ({ ...entity })),
    relations: path.relations.map(relation => ({
      ...relation, evidence: relation.evidence.map(source => ({ ...source })),
    })),
  };
}

export const SearchResourcesTool = Object.assign(
  function registerSearchResourcesTool(ctx: Context): () => void {
    const dispose = ctx.effect(() => ctx.tools.register(createSearchResourcesTool(ctx)), "resource.search-tool");
    return () => { void dispose(); };
  },
  { inject: ["tools", "projects", "nodes", "retrieval"] },
);
