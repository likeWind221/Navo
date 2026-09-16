import { createProjectId, createSessionId } from "../brand/ids.js";
import type { ProjectId } from "../brand/ids.js";
import { ProjectError } from "./errors.js";
import type { ProjectSnapshot } from "./model.js";

export function projectProject(
  projectId: ProjectId,
  events: readonly unknown[],
): ProjectSnapshot | undefined {
  if (!Array.isArray(events)) invalid("Project history must be an array.");
  let snapshot: ProjectSnapshot | undefined;
  const ids = new Set<string>();
  for (const raw of events) {
    const event = record(raw);
    if (event.version !== 1) invalid("Unsupported Project event version.");
    const id = text(event.id, "event id");
    if (ids.has(id)) invalid("Project event IDs must be unique.");
    ids.add(id);
    if (text(event.projectId, "project id") !== projectId) {
      invalid("Event belongs to a different Project.");
    }
    if (!Number.isSafeInteger(event.revision)
      || event.revision !== (snapshot?.revision ?? 0) + 1) {
      invalid("Project revisions must be contiguous from 1.");
    }
    const timestamp = text(event.timestamp, "timestamp");
    if (!Number.isFinite(Date.parse(timestamp))
      || new Date(timestamp).toISOString() !== timestamp) {
      invalid("Project timestamp must be a canonical ISO timestamp.");
    }
    const data = record(event.data);
    switch (event.type) {
      case "project-created":
        if (snapshot !== undefined) invalid("Project was already created.");
        snapshot = {
          id: createProjectId(projectId),
          goal: text(data.goal, "goal"),
          mainSessionId: createSessionId(text(data.mainSessionId, "main session id")),
          status: "active",
          revision: 1,
        };
        break;
      case "project-archived":
      case "project-reopened": {
        const expected = event.type === "project-archived" ? "active" : "archived";
        if (snapshot === undefined || snapshot.status !== expected) {
          invalid(`Cannot apply ${String(event.type)} to the current Project state.`);
        }
        text(data.reason, "lifecycle reason");
        snapshot = {
          ...snapshot,
          status: event.type === "project-archived" ? "archived" : "active",
          revision: snapshot.revision + 1,
        };
        break;
      }
      default:
        invalid("Unknown Project event type.");
    }
  }
  return snapshot === undefined ? undefined : Object.freeze(snapshot);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid("Project event and data must be objects.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(`${name} must be non-empty text.`);
  return value;
}

function invalid(message: string): never {
  throw new ProjectError("invalid-event-stream", message);
}
