import type { Context } from "cordis";

import type { JsonObject } from "../../../llm/types.js";
import { createFileEnvironment } from "../file/path.js";
import { readTextFile } from "../file/read.js";
import { FILE_LIMITS } from "../file/types.js";
import type { ToolDefinition } from "../../types.js";
import {
  requireResourceToolCaller,
  resolveResourceRef,
  resourceArtifact,
  RESOURCE_ID_PARAMETER,
  resourceToolFailure,
} from "./common.js";

export const FETCH_RESOURCE_TOOL_NAME = "fetch_resource";

const schema: JsonObject = {
  type: "object",
  properties: {
    resource_id: RESOURCE_ID_PARAMETER,
    start_line: {
      type: "integer",
      description: "1-based inclusive line, default 1.",
    },
    max_lines: {
      type: "integer",
      description: "Maximum complete lines, default 200 and at most 1000.",
    },
  },
  required: ["resource_id"],
  additionalProperties: false,
};

export function createFetchResourceTool(ctx: Context): ToolDefinition {
  return {
    name: FETCH_RESOURCE_TOOL_NAME,
    description: "Read original text of a visible Resource using an ID returned by search_resources or list_resources, or fetch a known valid ID directly without discovery first. Use start_line and max_lines to page through evidence or read more context as needed. Shared and public Resources are read-only unless the current Agent is the owner.",
    parameters: schema,
    async execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const caller = requireResourceToolCaller(ctx, execution.sessionId);
        const id = resolveResourceRef(ctx, caller, arguments_.resource_id);
        return await ctx.resources.withEntry(caller.projectId, id, caller.principal, async (resource, target) => {
          const environment = await createFileEnvironment(target.root, target.root);
          const result = await readTextFile(environment, {
            path: resource.entryRef,
            ...(arguments_.start_line === undefined
              ? {}
              : { startLine: arguments_.start_line as number }),
            ...(arguments_.max_lines === undefined
              ? {}
              : { maxLines: arguments_.max_lines as number }),
          }, execution.signal);
          const body = result.lines
            .map(({ line, text }) => `${line}: ${text}`)
            .join("\n");
          const footer = result.nextLine === null
            ? "[End of Resource]"
            : `[Continue with start_line=${result.nextLine}]`;
          return {
            content: [
              `Resource: ${resource.name} (${resource.id})`,
              `Revision: ${resource.revision}`,
              `Lines: ${result.totalLines}`,
              "",
              body,
              footer,
            ].join("\n"),
            artifact: {
              ...resourceArtifact(resource),
              start_line: result.startLine,
              total_lines: result.totalLines,
              next_line: result.nextLine,
              max_lines: arguments_.max_lines === undefined
                ? FILE_LIMITS.defaultReadLines
                : arguments_.max_lines,
            },
          };
        });
      } catch (error: unknown) {
        return resourceToolFailure(error);
      }
    },
  };
}

export const FetchResourceTool = Object.assign(
  function registerFetchResourceTool(ctx: Context): () => void {
    const dispose = ctx.effect(
      () => ctx.tools.register(createFetchResourceTool(ctx)),
      "resource.fetch-tool",
    );
    return () => { void dispose(); };
  },
  { inject: ["tools", "projects", "nodes", "resources"] },
);
