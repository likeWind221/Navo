import { Service } from "cordis";
import type { Context } from "cordis";

import type { ToolCallId } from "../brand/ids.js";
import type {
  JsonObject,
  TextContentBlock,
  ToolCallContentBlock,
  ToolSchema,
} from "../llm/types.js";
import { ToolExecutionError, ToolServiceError } from "./errors.js";
import { parseToolArguments, snapshotParameters } from "./schema.js";
import type {
  ToolDefinition,
  ToolExecutionFailure,
  ToolExecutionResult,
  ToolExecutionSuccess,
  ToolFailure,
  ToolOutput,
  ToolRegistration,
} from "./types.js";

export type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionFailure,
  ToolExecutionResult,
  ToolExecutionSuccess,
  ToolFailure,
  ToolFailureCode,
  ToolOutput,
  ToolRegistration,
} from "./types.js";
export {
  ToolExecutionError,
  ToolServiceError,
  isToolExecutionError,
  isToolServiceError,
} from "./errors.js";
export type { ToolServiceErrorCode } from "./errors.js";

declare module "cordis" {
  interface Context {
    tools: ToolService;
  }
}

/** Provider-independent tool registry and sequential execution boundary. */
export class ToolService extends Service {
  private readonly tools = new Map<string, RegisteredTool>();

  constructor(ctx: Context) {
    super(ctx, "tools");
  }

  register(definition: ToolDefinition): ToolRegistration {
    const registered = snapshotDefinition(definition);
    if (this.tools.has(registered.schema.name)) {
      throw new ToolServiceError(
        "tool-already-registered",
        `Tool '${registered.schema.name}' is already registered.`,
      );
    }

    this.tools.set(registered.schema.name, registered);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this.tools.get(registered.schema.name) === registered) {
        this.tools.delete(registered.schema.name);
      }
    };
  }

  schemas(): readonly ToolSchema[] {
    return Object.freeze(
      [...this.tools.values()].map(({ schema }) =>
        deepFreeze(structuredClone(schema))),
    );
  }

  async execute(
    call: ToolCallContentBlock,
    signal: AbortSignal,
  ): Promise<ToolExecutionResult> {
    if (signal.aborted) return cancelledResult(call.id);

    const tool = this.tools.get(call.name);
    if (!tool) {
      return failureResult(call.id, {
        code: "unknown-tool",
        message: `Unknown tool '${call.name}'.`,
      });
    }

    const parsed = parseToolArguments(call, tool.schema.parameters);
    if (parsed.kind === "failure") {
      return failureResult(call.id, parsed.failure);
    }

    const context = Object.freeze({ callId: call.id, signal });
    let output: ToolOutput;
    try {
      output = await tool.execute(parsed.arguments, context);
    } catch (error: unknown) {
      if (signal.aborted) {
        return cancelledResult(call.id);
      }
      return toolFailedResult(call.id, error);
    }

    try {
      return successResult(call.id, normalizeOutput(output));
    } catch (error: unknown) {
      return toolFailedResult(call.id, error);
    }
  }

}

interface RegisteredTool {
  readonly schema: ToolSchema;
  readonly execute: ToolDefinition["execute"];
}

function snapshotDefinition(definition: ToolDefinition): RegisteredTool {
  const name = definition.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw invalidDefinition("Tool name must be a non-empty string.");
  }
  if (definition.description !== undefined
    && typeof definition.description !== "string") {
    throw invalidDefinition(`Tool '${name}' description must be a string.`);
  }
  if (typeof definition.execute !== "function") {
    throw invalidDefinition(`Tool '${name}' must provide an execute function.`);
  }

  const schema = deepFreeze({
    name,
    ...(definition.description === undefined
      ? {}
      : { description: definition.description }),
    parameters: snapshotParameters(definition.parameters, name),
  });
  return Object.freeze({ schema, execute: definition.execute });
}

function normalizeOutput(output: ToolOutput): readonly TextContentBlock[] {
  if (typeof output === "string") {
    return Object.freeze([{ type: "text", text: output }]);
  }

  const detached = structuredClone(output) as unknown;
  if (!Array.isArray(detached)) {
    throw new TypeError("Tool output must be a string or an array of text blocks.");
  }
  for (const [index, block] of detached.entries()) {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
      throw new TypeError(`Tool output block at index ${index} must be a text block.`);
    }
  }
  return deepFreeze(detached as TextContentBlock[]);
}

function successResult(
  callId: ToolCallId,
  content: readonly TextContentBlock[],
): ToolExecutionSuccess {
  return deepFreeze({
    kind: "success",
    block: {
      type: "tool-result",
      toolCallId: callId,
      content,
      isError: false,
    },
  });
}

function failureResult(
  callId: ToolCallId,
  failure: ToolFailure,
): ToolExecutionFailure {
  const modelMessage = modelVisibleFailureMessage(failure);
  return deepFreeze({
    kind: "failure",
    block: {
      type: "tool-result",
      toolCallId: callId,
      content: [{ type: "text", text: `Error: ${modelMessage}` }],
      isError: true,
    },
    failure,
  });
}

function cancelledResult(callId: ToolCallId): ToolExecutionFailure {
  return failureResult(callId, {
    code: "cancelled",
    message: "Tool call was cancelled.",
  });
}

function toolFailedResult(
  callId: ToolCallId,
  error: unknown,
): ToolExecutionFailure {
  return failureResult(callId, {
    code: "tool-failed",
    message: errorMessage(error),
    ...(error instanceof ToolExecutionError
      ? { modelMessage: error.modelMessage }
      : {}),
  });
}

function modelVisibleFailureMessage(failure: ToolFailure): string {
  if (failure.modelMessage !== undefined) {
    return failure.modelMessage;
  }
  if (failure.code !== "tool-failed") {
    return failure.message;
  }
  return "Tool execution failed unexpectedly. Check the arguments or try another approach.";
}

function invalidDefinition(message: string): ToolServiceError {
  return new ToolServiceError("invalid-tool-definition", message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value) as T;
}
