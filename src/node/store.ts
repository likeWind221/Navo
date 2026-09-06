import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context, Logger } from "cordis";

import {
  createEventId,
  createExerciseId,
  createNodeId,
} from "../brand/ids.js";
import type { ExerciseId, NodeId, SessionId } from "../brand/ids.js";
import { NodeError } from "./errors.js";
import type { NodeEvent } from "./events.js";
import type {
  CapabilityTarget,
  Exercise,
  MaterialDocument,
  NodeSnapshot,
  SourceReference,
} from "./model.js";
import { projectNode } from "./projector.js";

/** Input accepted when the Node domain creates an identity. */
export interface CreateNodeInput {
  readonly capability: CapabilityTarget;
  readonly sources?: readonly SourceReference[];
}

export interface ReplaceMaterialInput {
  readonly text: string;
  readonly sources?: readonly SourceReference[];
}

export interface ReplaceExerciseSetInput {
  readonly exercises: readonly ExerciseInput[];
}

export interface ExerciseInput {
  readonly id?: ExerciseId;
  readonly prompt: string;
  readonly referenceAnswer: string;
}

/** An event before the Store assigns identity, revision, and commit time. */
export type NodeEventDraft<TEvent extends NodeEvent = NodeEvent> =
  TEvent extends NodeEvent
    ? Omit<TEvent, "id" | "revision" | "timestamp">
    : never;

declare module "cordis" {
  interface Context {
    nodes: NodeStore;
  }

  interface Events {
    "node/event": (event: NodeEvent) => void;
  }
}

/** In-memory Node event store and strict current-state projection. */
export class NodeStore extends Service {
  private readonly events = new Map<NodeId, NodeEvent[]>();
  private readonly logger: Logger;

  constructor(ctx: Context) {
    super(ctx, "nodes");
    this.logger = ctx.logger("node");
  }

  create(input: CreateNodeInput): NodeSnapshot {
    const nodeId = this.nextNodeId();
    this.append({
      type: "node-created",
      nodeId,
      data: {
        capability: input.capability,
        sources: input.sources ?? [],
      },
    });
    return this.require(nodeId);
  }

  get(nodeId: NodeId): NodeSnapshot | undefined {
    return projectNode(nodeId, this.events.get(nodeId) ?? []);
  }

  getBySession(sessionId: SessionId): NodeSnapshot | undefined {
    for (const nodeId of this.events.keys()) {
      const snapshot = this.get(nodeId);
      if (snapshot?.sessionId === sessionId) return snapshot;
    }
    return undefined;
  }

  getEvents(nodeId: NodeId): readonly NodeEvent[] {
    return Object.freeze([...(this.events.get(nodeId) ?? [])]);
  }

  bindSession(nodeId: NodeId, sessionId: SessionId): NodeSnapshot {
    const current = this.require(nodeId);
    if (current.sessionId !== undefined) {
      throw new NodeError(
        "node-already-bound",
        `Node '${nodeId}' is already bound to Session '${current.sessionId}'.`,
      );
    }
    const owner = this.getBySession(sessionId);
    if (owner !== undefined) {
      throw new NodeError(
        "session-already-bound",
        `Session '${sessionId}' is already bound to Node '${owner.node.id}'.`,
      );
    }
    this.append({ type: "session-bound", nodeId, data: { sessionId } });
    return this.require(nodeId);
  }

  replaceMaterial(nodeId: NodeId, input: ReplaceMaterialInput): NodeSnapshot {
    const current = this.requireBound(nodeId);
    const text = requiredText(input.text, "material text");
    const sources = (input.sources ?? []).map((source, index) => ({
      reference: requiredText(source.reference, `material source ${index + 1}`),
      ...(source.label === undefined
        ? {}
        : { label: requiredText(source.label, `material source ${index + 1} label`) }),
    }));
    const material: MaterialDocument = {
      revision: (current.content.material?.revision ?? 0) + 1,
      text,
      sources,
    };
    this.append({ type: "material-replaced", nodeId, data: { material } });
    return this.require(nodeId);
  }

  replaceExerciseSet(
    nodeId: NodeId,
    input: ReplaceExerciseSetInput,
  ): NodeSnapshot {
    const current = this.requireBound(nodeId);
    if (input.exercises.length === 0) {
      throw new NodeError("invalid-content", "Exercise set must not be empty.");
    }
    const used = new Set<ExerciseId>();
    const exercises: Exercise[] = input.exercises.map((exercise, index) => {
      const id = exercise.id ?? this.nextExerciseId(used);
      if (used.has(id)) {
        throw new NodeError("invalid-content", `Exercise '${id}' is duplicated.`);
      }
      used.add(id);
      return {
        id,
        prompt: requiredText(exercise.prompt, `exercise ${index + 1} prompt`),
        referenceAnswer: requiredText(
          exercise.referenceAnswer,
          `exercise ${index + 1} reference answer`,
        ),
      };
    });
    this.append({
      type: "exercise-set-replaced",
      nodeId,
      data: {
        exerciseSet: {
          revision: (current.content.exerciseSet?.revision ?? 0) + 1,
          exercises,
        },
      },
    });
    return this.require(nodeId);
  }

  private require(nodeId: NodeId): NodeSnapshot {
    const snapshot = this.get(nodeId);
    if (snapshot === undefined) {
      throw new NodeError("node-not-found", `Node '${nodeId}' was not found.`);
    }
    return snapshot;
  }

  private requireBound(nodeId: NodeId): NodeSnapshot {
    const snapshot = this.require(nodeId);
    if (snapshot.sessionId === undefined) {
      throw new NodeError(
        "node-session-required",
        `Node '${nodeId}' must bind a Session before content can change.`,
      );
    }
    return snapshot;
  }

  private append(draft: NodeEventDraft): NodeEvent {
    const events = this.events.get(draft.nodeId) ?? [];
    const event = immutable({
      ...draft,
      id: createEventId(randomUUID()),
      revision: events.length + 1,
      timestamp: new Date().toISOString(),
    }) as NodeEvent;
    projectNode(event.nodeId, [...events, event]);
    if (!this.events.has(event.nodeId)) this.events.set(event.nodeId, events);
    events.push(event);
    this.publish(event);
    return event;
  }

  private nextNodeId(): NodeId {
    let nodeId: NodeId;
    do nodeId = createNodeId(randomUUID());
    while (this.events.has(nodeId));
    return nodeId;
  }

  private nextExerciseId(used: ReadonlySet<ExerciseId>): ExerciseId {
    let id: ExerciseId;
    do id = createExerciseId(randomUUID());
    while (used.has(id));
    return id;
  }

  private publish(event: NodeEvent): void {
    void this.ctx.parallel("node/event", event).catch((error: unknown) => {
      this.logger.warn(
        "node/event observers failed for %s:%d: %o",
        event.nodeId,
        event.revision,
        error,
      );
    });
  }
}

function requiredText(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new NodeError("invalid-content", `${name} must not be empty.`);
  }
  return value;
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
