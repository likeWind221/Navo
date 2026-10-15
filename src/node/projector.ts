import type { NodeId } from "../brand/ids.js";
import { NodeError } from "./errors.js";
import type { NodeDefinitionChange, NodeEvent } from "./events.js";
import type { NodeObjective, NodeSnapshot, NodeStatus, NodeSubmissionInput } from "./model.js";

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
        objective(event.data.objective);
        snapshot = {
          node: { id: nodeId, projectId: event.data.projectId, kind: "work", objective: event.data.objective, requirement: event.data.requirement ?? "required" },
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
        controlPurpose(event.data.purpose);
        snapshot = {
          node: { id: nodeId, projectId: event.data.projectId, kind: "control", purpose: event.data.purpose, title: event.data.title, requirement: event.data.requirement ?? "required" },
          revision: event.revision, status: "locked",
        };
        break;
      }
      case "definition-changed": {
        if (!snapshot) invalid("Node must exist before its definition can change.");
        if (snapshot.status !== "locked" && snapshot.status !== "idle") {
          invalid("Node definition can change only while locked or idle.");
        }
        if (event.data.reviewedRevision !== snapshot.revision) invalid("Definition change refers to a stale Node revision.");
        text(event.data.reason);
        requirement(event.data.requirement);
        validateDefinitionChange(snapshot, event.data.definition);
        snapshot = event.data.definition.kind === "work"
          ? {
              ...snapshot,
              node: {
                id: snapshot.node.id,
                projectId: snapshot.node.projectId,
                kind: "work",
                objective: event.data.definition.objective,
                requirement: event.data.requirement,
              },
            }
          : {
              ...snapshot,
              node: {
                id: snapshot.node.id,
                projectId: snapshot.node.projectId,
                kind: "control",
                purpose: event.data.definition.purpose,
                title: event.data.definition.title,
                requirement: event.data.requirement,
              },
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
      case "work-started": {
        requireStatus(snapshot, "idle");
        if (snapshot!.node.kind !== "work") invalid("Control nodes cannot execute.");
        if (snapshot!.sessionId === undefined) invalid("Working Node requires a Session.");
        const { pendingFeedback: _, ...rest } = snapshot!;
        snapshot = { ...rest, status: "working" };
        break;
      }
      case "completion-signaled":
        requireStatus(snapshot, "working");
        if (snapshot!.submission !== undefined) invalid("Node already signaled completion in this Turn.");
        submission(snapshot!, event.data);
        snapshot = { ...snapshot!, submission: { ...event.data, submittedAt: event.timestamp } };
        break;
      case "work-ended":
        requireStatus(snapshot, "working");
        snapshot = { ...snapshot!, status: snapshot!.submission === undefined ? "idle" : "submitted" };
        break;
      case "rework-requested": {
        requireStatus(snapshot, "submitted", "idle");
        text(event.data.requestedBy);
        text(event.data.feedback);
        if (event.data.reviewedRevision !== snapshot!.revision) invalid("Rework refers to a stale Node revision.");
        const { submission: _, ...rest } = snapshot!;
        snapshot = {
          ...rest,
          status: "idle",
          pendingFeedback: { ...event.data, requestedAt: event.timestamp },
          reworkCount: (snapshot!.reworkCount ?? 0) + 1,
        };
        break;
      }
      case "review-recorded":
        requireStatus(snapshot, "idle", "submitted", "completing", "skipped");
        if (snapshot!.node.kind !== "work") invalid("Control nodes cannot be reviewed.");
        if (event.data.turnId !== undefined) text(event.data.turnId);
        text(event.data.reason);
        if (!["complete", "rework", "skip", "escalate"].includes(event.data.decision)) invalid("Invalid review decision.");
        if (!Number.isSafeInteger(event.data.reviewedRevision) || event.data.reviewedRevision < 1
          || event.data.reviewedRevision > snapshot!.revision) invalid("Review refers to an invalid Node revision.");
        snapshot = { ...snapshot!, lastReview: { ...event.data, reviewedAt: event.timestamp } };
        break;
      case "completion-confirmed":
      case "node-skipped": {
        requireStatus(snapshot, ...(event.type === "node-skipped"
          ? ["locked", "idle", "submitted"] as const : ["idle", "submitted"] as const));
        text(event.data.confirmedBy);
        text(event.data.reason);
        if (event.data.reviewedRevision !== snapshot!.revision) invalid("Confirmation refers to a stale Node revision.");
        const { pendingFeedback: _, ...rest } = snapshot!;
        snapshot = { ...rest, status: event.type === "node-skipped" ? "skipped" : "completing", confirmation: event.data };
        break;
      }
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

function validateDefinitionChange(snapshot: NodeSnapshot, definition: NodeDefinitionChange): void {
  if (definition.kind !== snapshot.node.kind) invalid("Node kind cannot change.");
  if (definition.kind === "work") {
    objective(definition.objective);
    return;
  }
  text(definition.title);
  controlPurpose(definition.purpose);
}

function objective(value: NodeObjective): void {
  if (!value || typeof value !== "object") invalid("Node objective is required.");
  text(value.title);
  text(value.description);
  if (!Array.isArray(value.acceptanceCriteria) || value.acceptanceCriteria.length === 0) {
    invalid("Node acceptance criteria are required.");
  }
  value.acceptanceCriteria.forEach(text);
}

function submission(snapshot: NodeSnapshot, value: NodeSubmissionInput): void {
  if (snapshot.node.kind !== "work") invalid("Control nodes cannot signal completion.");
  text(value.summary);
  if (!Array.isArray(value.resourceIds) || !Array.isArray(value.remaining) || !Array.isArray(value.criteria)) {
    invalid("Completion signal lists are required.");
  }
  value.resourceIds.forEach(text);
  if (new Set(value.resourceIds).size !== value.resourceIds.length) invalid("Completion signal repeats a Resource.");
  value.remaining.forEach(text);
  const expected = snapshot.node.objective.acceptanceCriteria;
  if (value.criteria.length !== expected.length) invalid("Completion signal must check every acceptance criterion.");
  value.criteria.forEach((check, index) => {
    if (!check || check.criterion !== expected[index] || typeof check.satisfied !== "boolean") {
      invalid("Completion signal criteria must follow the Node acceptance criteria.");
    }
    text(check.note);
  });
}

function controlPurpose(value: unknown): void {
  if (value !== "start" && value !== "end" && value !== "checkpoint") invalid("Invalid control purpose.");
}

function requireStatus(snapshot: NodeSnapshot | undefined, ...expected: readonly NodeStatus[]): void {
  if (snapshot === undefined || !expected.includes(snapshot.status)) {
    invalid("Node must be " + expected.join(" or ") + " for this event.");
  }
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
