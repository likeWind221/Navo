import type { Context } from "cordis";

import { createExerciseId } from "../brand/ids.js";
import type { NodeId, SessionId } from "../brand/ids.js";
import { NodeError } from "./errors.js";
import type { NodeSnapshot } from "./model.js";
import type {
  ExerciseInput,
  ReplaceExerciseSetInput,
  ReplaceMaterialInput,
} from "./store.js";
import type { JsonObject } from "../llm/types.js";
import { ToolExecutionError } from "../tools/errors.js";
import type { ToolExecutionContext, ToolRegistration } from "../tools/types.js";

export const NODE_CONTENT_TOOL_NAMES = Object.freeze({
  replaceMaterial: "replace_node_material",
  replaceExerciseSet: "replace_node_exercise_set",
} as const);

/** Registers Session-authorized tools that replace the current Node content. */
export const NodeContentTools = Object.assign(
  (ctx: Context): (() => void) => {
    const registrations: ToolRegistration[] = [];
    try {
      registrations.push(ctx.tools.register({
        name: NODE_CONTENT_TOOL_NAMES.replaceMaterial,
        description: "Replace this Node's complete plain-text teaching material.",
        parameters: materialSchema,
        execute(arguments_, execution) {
          const input: ReplaceMaterialInput = {
            text: arguments_.text as string,
            sources: ((arguments_.sources ?? []) as unknown as SourceArguments[]).map((source) => ({
              reference: source.reference,
              ...(source.label === undefined ? {} : { label: source.label }),
            })),
          };
          const snapshot = updateOwnedNode(ctx, execution, (nodeId) =>
            ctx.nodes.replaceMaterial(nodeId, input));
          return {
            content: `Material updated to revision ${snapshot.content.material!.revision}.`,
          };
        },
      }));
      registrations.push(ctx.tools.register({
        name: NODE_CONTENT_TOOL_NAMES.replaceExerciseSet,
        description: "Replace this Node's complete exercise set and private answer key.",
        parameters: exerciseSetSchema,
        execute(arguments_, execution) {
          const input: ReplaceExerciseSetInput = {
            exercises: (arguments_.exercises as unknown as ExerciseArguments[])
              .map(toExerciseInput),
          };
          const snapshot = updateOwnedNode(ctx, execution, (nodeId) =>
            ctx.nodes.replaceExerciseSet(nodeId, input));
          const exerciseSet = snapshot.content.exerciseSet!;
          return {
            content: `Exercise set updated to revision ${exerciseSet.revision} with ${exerciseSet.exercises.length} exercises.`,
          };
        },
      }));
    } catch (error: unknown) {
      disposeAll(registrations);
      throw error;
    }
    return () => disposeAll(registrations);
  },
  { inject: ["tools", "nodes"] },
);

interface SourceArguments {
  readonly reference: string;
  readonly label?: string;
}

interface ExerciseArguments {
  readonly id?: string;
  readonly prompt: string;
  readonly referenceAnswer: string;
}

const sourceSchema: JsonObject = {
  type: "object",
  properties: {
    reference: { type: "string" },
    label: { type: "string" },
  },
  required: ["reference"],
  additionalProperties: false,
};

const materialSchema: JsonObject = {
  type: "object",
  properties: {
    text: { type: "string" },
    sources: { type: "array", items: sourceSchema },
  },
  required: ["text"],
  additionalProperties: false,
};

const exerciseSchema: JsonObject = {
  type: "object",
  properties: {
    id: { type: "string" },
    prompt: { type: "string" },
    referenceAnswer: { type: "string" },
  },
  required: ["prompt", "referenceAnswer"],
  additionalProperties: false,
};

const exerciseSetSchema: JsonObject = {
  type: "object",
  properties: {
    exercises: { type: "array", items: exerciseSchema },
  },
  required: ["exercises"],
  additionalProperties: false,
};

function toExerciseInput(value: ExerciseArguments): ExerciseInput {
  return {
    ...(value.id === undefined ? {} : { id: createExerciseId(value.id) }),
    prompt: value.prompt,
    referenceAnswer: value.referenceAnswer,
  };
}

function updateOwnedNode(
  ctx: Context,
  execution: ToolExecutionContext,
  update: (nodeId: NodeId) => NodeSnapshot,
): NodeSnapshot {
  const sessionId = requireSession(execution.sessionId);
  const owner = ctx.nodes.getBySession(sessionId);
  if (owner === undefined) {
    throw new ToolExecutionError(
      `Session '${sessionId}' is not bound to a Node.`,
      "This Session is not authorized to modify Node content.",
    );
  }
  try {
    return update(owner.node.id);
  } catch (error: unknown) {
    if (!(error instanceof NodeError)) throw error;
    throw new ToolExecutionError(
      error.message,
      "The Node content update was rejected; revise the complete content and try again.",
      { cause: error },
    );
  }
}

function requireSession(sessionId: SessionId | undefined): SessionId {
  if (sessionId !== undefined) return sessionId;
  throw new ToolExecutionError(
    "Node content tool execution omitted its Session identity.",
    "This tool can only run inside an authorized Node conversation.",
  );
}

function disposeAll(registrations: ToolRegistration[]): void {
  for (const dispose of registrations.splice(0).reverse()) dispose();
}
