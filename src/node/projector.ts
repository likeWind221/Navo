import type { NodeId } from "../brand/ids.js";
import { NodeError } from "./errors.js";
import type { NodeEvent } from "./events.js";
import type { NodeSnapshot, NodeStatus } from "./model.js";

export function projectNode(nodeId: NodeId, events: readonly NodeEvent[]): NodeSnapshot | undefined {
  let snapshot: NodeSnapshot | undefined;
  const ids = new Set<string>();
  for (const event of events) {
    if (!event || event.version !== 2 || event.nodeId !== nodeId) invalid("Invalid Node event identity or version.");
    text(event.id);
    text(event.nodeId);
    if (ids.has(event.id)) invalid("Duplicate Node event ID.");
    ids.add(event.id);
    if (!Number.isSafeInteger(event.revision) || event.revision !== (snapshot?.revision ?? 0) + 1) {
      invalid("Node revisions must be contiguous.");
    }
    if (typeof event.timestamp !== "string" || !Number.isFinite(Date.parse(event.timestamp))) {
      invalid("Invalid Node event timestamp.");
    }
    if (!event.data || typeof event.data !== "object" || Array.isArray(event.data)) invalid("Invalid Node event data.");
    switch (event.type) {
      case "node-created": {
        if (snapshot) invalid("Node was already created.");
        text(event.data.projectId);
        requirement(event.data.requirement ?? "required");
        const objective = event.data.objective;
        if (!objective || typeof objective !== "object") invalid("Node objective is required.");
        text(objective.title);
        text(objective.description);
        if (!Array.isArray(objective.acceptanceCriteria) || objective.acceptanceCriteria.length === 0) {
          invalid("Node acceptance criteria are required.");
        }
        objective.acceptanceCriteria.forEach(text);
        snapshot = {
          node: { id: nodeId, projectId: event.data.projectId, kind: "work", objective, requirement: event.data.requirement ?? "required" },
          revision: event.revision,
          status: "locked",
        };
        break;
      }
      case "control-created": {
        if (snapshot) invalid("Node was already created.");
        text(event.data.projectId);
        requirement(event.data.requirement ?? "required");
        text(event.data.title);
        if (!["start", "end", "checkpoint"].includes(event.data.purpose)) invalid("Invalid control purpose.");
        snapshot = {
          node: { id: nodeId, projectId: event.data.projectId, kind: "control", purpose: event.data.purpose, title: event.data.title, requirement: event.data.requirement ?? "required" },
          revision: event.revision, status: "locked",
        };
        break;
      }
      case "session-bound":
        requireStatus(snapshot, "idle");
        if (snapshot!.node.kind !== "work") invalid("Control nodes cannot bind Sessions.");
        if (snapshot!.sessionId !== undefined) invalid("Node already owns a Session.");
        text(event.data.sessionId);
        snapshot = { ...snapshot!, sessionId: event.data.sessionId };
        break;
      case "node-unlocked":
        requireStatus(snapshot, "locked");
        text(event.data.reason);
        snapshot = { ...snapshot!, status: "idle" };
        break;
      case "node-locked":
        requireStatus(snapshot, "idle");
        text(event.data.reason);
        snapshot = { ...snapshot!, status: "locked" };
        break;
      case "work-started":
        requireStatus(snapshot, "idle");
        if (snapshot!.node.kind !== "work") invalid("Control nodes cannot execute.");
        if (snapshot!.sessionId === undefined) invalid("Working Node requires a Session.");
        snapshot = { ...snapshot!, status: "working" };
        break;
      case "work-ended":
        requireStatus(snapshot, "working");
        snapshot = { ...snapshot!, status: "idle" };
        break;
      case "completion-confirmed":
      case "node-skipped":
        if (event.type === "node-skipped" && snapshot?.status === "locked") {
          requireStatus(snapshot, "locked");
        } else requireStatus(snapshot, "idle");
        text(event.data.confirmedBy);
        text(event.data.reason);
        if (event.data.reviewedRevision !== snapshot!.revision) invalid("Confirmation refers to a stale Node revision.");
        snapshot = { ...snapshot!, status: event.type === "node-skipped" ? "skipped" : "completing", confirmation: event.data };
        break;
      case "requirement-changed":
        if (!snapshot) invalid("Node must exist.");
        requirement(event.data.requirement);
        text(event.data.reason);
        if (event.data.reviewedRevision !== snapshot.revision) invalid("Requirement change refers to a stale revision.");
        snapshot = { ...snapshot, node: { ...snapshot.node, requirement: event.data.requirement } };
        break;
      default:
        invalid("Unsupported Node event type.");
    }
    snapshot = { ...snapshot!, revision: event.revision };
  }
  return snapshot === undefined ? undefined : immutable(snapshot);
}

export function immutable<T>(value: T): T {
  const copy = structuredClone(value);
  function freeze(item: unknown): void {
    if (item === null || typeof item !== "object" || Object.isFrozen(item)) return;
    Object.values(item).forEach(freeze);
    Object.freeze(item);
  }
  freeze(copy);
  return copy;
}

function requireStatus(snapshot: NodeSnapshot | undefined, expected: NodeStatus): void {
  if (snapshot?.status !== expected) invalid("Node must be " + expected + " for this event.");
}

function text(value: unknown): void {
  if (typeof value !== "string" || !value.trim()) invalid("Node fields must contain non-empty text.");
}

function invalid(message: string): never {
  throw new NodeError("invalid-event-stream", message);
}

function requirement(value: unknown): void {
  if (value !== "required" && value !== "optional") invalid("Invalid Node requirement.");
}
