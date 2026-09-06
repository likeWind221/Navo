import type { ExerciseId, NodeId } from "../brand/ids.js";
import { NodeError } from "./errors.js";
import type { NodeEvent } from "./events.js";
import type {
  ExerciseSet,
  MaterialDocument,
  Node,
  NodeSnapshot,
} from "./model.js";

/** Strictly reconstruct one Node from its complete committed event stream. */
export function projectNode(
  nodeId: NodeId,
  events: readonly NodeEvent[],
): NodeSnapshot | undefined {
  let node: Node | undefined;
  let sessionId: NodeSnapshot["sessionId"];
  let material: MaterialDocument | undefined;
  let exerciseSet: ExerciseSet | undefined;
  let revision = 0;

  for (const event of events) {
    if (event.nodeId !== nodeId) {
      invalid(`Node event '${event.id}' belongs to a different Node.`);
    }
    if (!Number.isSafeInteger(event.revision) || event.revision !== revision + 1) {
      invalid(`Node '${nodeId}' revision ${event.revision} is not contiguous.`);
    }

    switch (event.type) {
      case "node-created":
        if (node !== undefined || revision !== 0) {
          invalid(`Node '${nodeId}' was created more than once or after another event.`);
        }
        node = {
          id: nodeId,
          capability: event.data.capability,
          sources: event.data.sources,
        };
        break;
      case "session-bound":
        if (node === undefined) {
          invalid(`Node '${nodeId}' bound a Session before it was created.`);
        }
        if (sessionId !== undefined) {
          invalid(`Node '${nodeId}' bound more than one Session.`);
        }
        sessionId = event.data.sessionId;
        break;
      case "material-replaced":
        requireContentOwner(nodeId, node, sessionId);
        assertContentRevision("material", material?.revision, event.data.material.revision);
        material = event.data.material;
        break;
      case "exercise-set-replaced":
        requireContentOwner(nodeId, node, sessionId);
        assertContentRevision(
          "exercise set",
          exerciseSet?.revision,
          event.data.exerciseSet.revision,
        );
        assertUniqueExercises(event.data.exerciseSet);
        exerciseSet = event.data.exerciseSet;
        break;
      default:
        exhaustive(event);
    }
    revision = event.revision;
  }

  if (node === undefined) {
    if (events.length !== 0) invalid(`Node '${nodeId}' has no creation event.`);
    return undefined;
  }
  return immutable({
    node,
    revision,
    content: {
      ...(material === undefined ? {} : { material }),
      ...(exerciseSet === undefined ? {} : { exerciseSet }),
    },
    ...(sessionId === undefined ? {} : { sessionId }),
  });
}

function requireContentOwner(
  nodeId: NodeId,
  node: Node | undefined,
  sessionId: NodeSnapshot["sessionId"],
): void {
  if (node === undefined || sessionId === undefined) {
    invalid(`Node '${nodeId}' changed content before creation and Session binding.`);
  }
}

function assertContentRevision(
  name: string,
  current: number | undefined,
  candidate: number,
): void {
  const expected = (current ?? 0) + 1;
  if (!Number.isSafeInteger(candidate) || candidate !== expected) {
    invalid(`${name} revision ${candidate} is not contiguous; expected ${expected}.`);
  }
}

function assertUniqueExercises(exerciseSet: ExerciseSet): void {
  const ids = new Set<ExerciseId>();
  for (const exercise of exerciseSet.exercises) {
    if (ids.has(exercise.id)) invalid(`Exercise '${exercise.id}' appears more than once.`);
    ids.add(exercise.id);
  }
}

function invalid(message: string): never {
  throw new NodeError("invalid-event-stream", message);
}

function exhaustive(value: never): never {
  throw new NodeError(
    "invalid-event-stream",
    `Unsupported Node event '${String((value as NodeEvent).type)}'.`,
  );
}

function immutable<TValue>(value: TValue): TValue {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<TValue>(value: TValue, seen = new Set<object>()): TValue {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value) as TValue;
}
