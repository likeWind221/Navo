import type { Context } from "cordis";

import type { JsonObject } from "../../../llm/types.js";
import { sameResourcePrincipal } from "../../../resource/access.js";
import { insideFolder } from "../../../resource/library.js";
import type { ToolDefinition } from "../../types.js";
import {
  invalidResourceTool,
  requireResourceToolCaller,
  resourceToolFailure,
  resourceToolFolder,
  resourceToolLimit,
} from "./common.js";

export const LIST_RESOURCES_TOOL_NAME = "list_resources";

const schema: JsonObject = {
  type: "object",
  properties: {
    query: { type: "string", description: "Optional case-insensitive substring of a Resource name or description." },
    folder: { type: "string", description: "Optional logical library folder, including descendants; empty means all folders." },
    limit: { type: "integer", description: "Page size, default 30, from 1 through 100." },
    offset: { type: "integer", description: "Offset in the filtered visible list, default 0; a non-negative safe integer." },
  },
  additionalProperties: false,
};

export function createListResourcesTool(ctx: Context): ToolDefinition {
  return {
    name: LIST_RESOURCES_TOOL_NAME,
    description: "Discover visible Resource metadata or browse a library folder without reading text. Filter by name or description and page with next_offset. For a specific topic or evidence prefer search_resources; use fetch_resource for original text. Skip discovery when a valid Resource ID or sufficient information is already known.",
    parameters: schema,
    execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const caller = requireResourceToolCaller(ctx, execution.sessionId);
        const query = arguments_.query ?? "";
        if (typeof query !== "string") throw invalidResourceTool("query must be a string.");
        const folder = resourceToolFolder(arguments_.folder);
        const limit = resourceToolLimit(arguments_.limit, 30, "limit");
        const offset = arguments_.offset ?? 0;
        if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) {
          throw invalidResourceTool("offset must be a non-negative safe integer.");
        }
        const key = query.toLowerCase();
        const visible = ctx.resources.listVisible(caller.projectId, caller.principal)
          .filter(resource => (!folder || insideFolder(resource.libraryPath, folder))
            && (resource.name.toLowerCase().includes(key) || resource.description.toLowerCase().includes(key)));
        const resources = visible.slice(offset, offset + limit).map(resource => ({
          resource_id: String(resource.id), name: resource.name, description: resource.description,
          type: resource.type, libraryPath: resource.libraryPath, revision: resource.revision,
          ownedByCurrentAgent: sameResourcePrincipal(resource.owner, caller.principal),
        }));
        const hasMore = offset + resources.length < visible.length;
        const result = { resources, has_more: hasMore, next_offset: hasMore ? offset + resources.length : null };
        return { content: JSON.stringify(result), artifact: result };
      } catch (error: unknown) {
        return resourceToolFailure(error);
      }
    },
  };
}

export const ListResourcesTool = Object.assign(
  function registerListResourcesTool(ctx: Context): () => void {
    const dispose = ctx.effect(() => ctx.tools.register(createListResourcesTool(ctx)), "resource.list-tool");
    return () => { void dispose(); };
  },
  { inject: ["tools", "projects", "nodes", "resources"] },
);
