import type { DatabaseSync } from "node:sqlite";

import { createNodeId, createProjectId, createSessionId } from "../brand/ids.js";
import { NodeError } from "../node/errors.js";
import { projectNode } from "../node/projector.js";
import type { NodeEvent } from "../node/events.js";
import { MailboxError } from "../mailbox/errors.js";
import { parseMailboxHistory } from "../mailbox/history.js";
import { ProjectError } from "../project/errors.js";
import { projectProject } from "../project/projector.js";
import { RoadmapError } from "../roadmap/errors.js";
import { projectRoadmap } from "../roadmap/projector.js";
import type { RoadmapEvent } from "../roadmap/events.js";
import { ResourceError } from "../resource/errors.js";
import { parseResourceHistory } from "../resource/history.js";
import type { ResourceHistoryContext } from "../resource/validation.js";
import { SessionError } from "../session/errors.js";
import { parseSessionHistory } from "../session/history.js";
import type { StoredHistory, EventDomain, WorkspaceBindingRecord } from "./database.js";
import { StorageError } from "./errors.js";

export interface RecoveryPlan {
  readonly validProjectIds: ReadonlySet<string>;
  readonly events: ReadonlyMap<EventDomain, ReadonlyMap<string, StoredHistory>>;
  readonly workspaceBindings: readonly WorkspaceBindingRecord[];
  readonly failures: readonly RecoveryFailure[];
}

export interface RecoveryFailure {
  readonly projectId: string;
  readonly domain: EventDomain | "workspace";
  readonly ownerId: string;
  readonly sequence?: number;
  readonly reason: string;
}

class RecoveryError extends Error {}

export function buildRecoveryPlan(db: DatabaseSync): RecoveryPlan {
  const invalid = new Set<string>();
  const failures: RecoveryFailure[] = [];
  const events = new Map<EventDomain, ReadonlyMap<string, StoredHistory>>();
  const domains: readonly EventDomain[] = ["project", "node", "roadmap", "mailbox", "resource", "session"];

  for (const domain of domains) {
    events.set(domain, readHistories(db, domain, invalid, failures));
  }

  const projects = events.get("project")!;
  const projectSnapshots = new Map<string, ReturnType<typeof projectProject>>();
  const mainSessions = new Map<string, string>();
  for (const [projectId, history] of projects) {
    try {
      if (history.projectId !== projectId) throw new RecoveryError("Project owner does not match its history.");
      const snapshot = projectProject(createProjectId(projectId), history.events);
      if (snapshot === undefined) throw new RecoveryError("Project history is empty.");
      const owner = mainSessions.get(snapshot.mainSessionId);
      if (owner !== undefined) {
        markInvalid(invalid, failures, "project", projectId, projectId, `Main Session is also owned by Project ${owner}.`);
        markInvalid(invalid, failures, "project", owner, owner, `Main Session is also owned by Project ${projectId}.`);
      } else {
        mainSessions.set(snapshot.mainSessionId, projectId);
      }
      projectSnapshots.set(projectId, snapshot);
    } catch (error: unknown) {
      if (!isRecoverable(error)) throw error;
      markInvalid(invalid, failures, "project", projectId, projectId, reason(error));
    }
  }

  const bindings = readBindings(db, invalid, failures);
  const boundProjects = new Set<string>();
  const boundRoots = new Set<string>();
  const validBindings: WorkspaceBindingRecord[] = [];
  for (const binding of bindings) {
    if (!projectSnapshots.has(binding.projectId) || invalid.has(binding.projectId)) {
      markInvalid(invalid, failures, "workspace", binding.projectId, binding.projectId, "Workspace references an unavailable Project.");
      continue;
    }
    if (boundProjects.has(binding.projectId) || boundRoots.has(binding.root)) {
      markInvalid(invalid, failures, "workspace", binding.projectId, binding.projectId, "Workspace binding conflicts with another binding.");
      continue;
    }
    boundProjects.add(binding.projectId);
    boundRoots.add(binding.root);
    validBindings.push(binding);
  }

  const nodes = events.get("node")!;
  const nodeSnapshots = new Map<string, ReturnType<typeof projectNode>>();
  const sessions = new Map<string, string>();
  for (const [nodeId, history] of nodes) {
    try {
      const snapshot = projectNode(createNodeId(nodeId), history.events as readonly NodeEvent[]);
      if (snapshot === undefined || history.projectId !== snapshot.node.projectId) {
        throw new RecoveryError("Node owner does not match its history.");
      }
      if (!projectSnapshots.has(history.projectId) || invalid.has(history.projectId)) {
        throw new RecoveryError("Node references an unavailable Project.");
      }
      if (snapshot.sessionId !== undefined) {
        const mainOwner = mainSessions.get(snapshot.sessionId);
        if (mainOwner !== undefined) {
          throw new RecoveryError(`Session is already owned by Project ${mainOwner}.`);
        }
        const owner = sessions.get(snapshot.sessionId);
        if (owner !== undefined) throw new RecoveryError("Session belongs to multiple Nodes.");
        sessions.set(snapshot.sessionId, history.projectId);
      }
      nodeSnapshots.set(nodeId, snapshot);
    } catch (error: unknown) {
      if (!isRecoverable(error)) throw error;
      markInvalid(invalid, failures, "node", history.projectId, nodeId, reason(error));
      nodeSnapshots.delete(nodeId);
    }
  }

  const roadmap = events.get("roadmap")!;
  for (const [projectId, history] of roadmap) {
    try {
      if (history.projectId !== projectId || !projectSnapshots.has(projectId) || invalid.has(projectId)) {
        throw new RecoveryError("Roadmap references an unavailable Project.");
      }
      const catalog = [...nodeSnapshots.values()]
        .filter(snapshot => snapshot?.node.projectId === projectId)
        .map(snapshot => snapshot!.node);
      if (!projectRoadmap(createProjectId(projectId), history.events as readonly RoadmapEvent[], catalog)) {
        throw new RecoveryError("Roadmap history is empty.");
      }
    } catch (error: unknown) {
      if (!isRecoverable(error)) throw error;
      markInvalid(invalid, failures, "roadmap", projectId, projectId, reason(error));
    }
  }

  const mailbox = events.get("mailbox")!;
  for (const [projectId, history] of mailbox) {
    try {
      if (history.projectId !== projectId || !projectSnapshots.has(projectId) || invalid.has(projectId)) {
        throw new RecoveryError("Mailbox references an unavailable Project.");
      }
      parseMailboxHistory(
        createProjectId(projectId),
        history.events,
        projectSnapshots,
        nodeSnapshots,
      );
    } catch (error: unknown) {
      if (!isRecoverable(error)) throw error;
      markInvalid(invalid, failures, "mailbox", projectId, projectId, reason(error));
    }
  }

  const resources = events.get("resource")!;
  const resourceEvents = new Map<string, string>();
  const resourceIds = new Map<string, string>();
  for (const [projectId, history] of resources) {
    try {
      if (history.projectId !== projectId || !projectSnapshots.has(projectId) || invalid.has(projectId)) {
        throw new RecoveryError("Resource references an unavailable Project.");
      }
      const parsed = parseResourceHistory(
        recoveryContext(projectSnapshots, nodeSnapshots),
        createProjectId(projectId),
        history.events,
      );
      for (const event of parsed) {
        const eventOwner = resourceEvents.get(event.id);
        if (eventOwner !== undefined) {
          markInvalid(invalid, failures, "resource", eventOwner, event.id, `Resource event ID is also owned by Project ${projectId}.`);
          markInvalid(invalid, failures, "resource", projectId, event.id, `Resource event ID is also owned by Project ${eventOwner}.`);
        } else {
          resourceEvents.set(event.id, projectId);
        }
        const resourceOwner = resourceIds.get(event.resourceId);
        if (resourceOwner !== undefined && resourceOwner !== projectId) {
          markInvalid(invalid, failures, "resource", resourceOwner, event.resourceId, `Resource ID is also owned by Project ${projectId}.`);
          markInvalid(invalid, failures, "resource", projectId, event.resourceId, `Resource ID is also owned by Project ${resourceOwner}.`);
        } else {
          resourceIds.set(event.resourceId, projectId);
        }
      }
    } catch (error: unknown) {
      if (!isRecoverable(error)) throw error;
      markInvalid(invalid, failures, "resource", projectId, projectId, reason(error));
    }
  }

  for (const [sessionId, history] of events.get("session")!) {
    try {
      const owner = mainSessions.get(sessionId) ?? sessions.get(sessionId);
      if (owner !== history.projectId || !projectSnapshots.has(history.projectId) || invalid.has(history.projectId)) {
        throw new RecoveryError("Session does not belong to an available Main or Node in its Project.");
      }
      parseSessionHistory(createSessionId(sessionId), history.events);
    } catch (error: unknown) {
      if (!isRecoverable(error)) throw error;
      markInvalid(invalid, failures, "session", history.projectId, sessionId, reason(error));
    }
  }

  const validProjectIds = new Set<string>();
  for (const projectId of projectSnapshots.keys()) {
    if (!invalid.has(projectId)) validProjectIds.add(projectId);
  }
  return Object.freeze({
    validProjectIds,
    events: new Map([...events].map(([domain, histories]) => [
      domain,
      new Map([...histories].filter(([ownerId, history]) => validProjectIds.has(history.projectId) && ownerId !== "")),
    ])),
    workspaceBindings: Object.freeze(validBindings.filter(binding => validProjectIds.has(binding.projectId))),
    failures: Object.freeze(failures),
  });
}

function readHistories(
  db: DatabaseSync,
  domain: EventDomain,
  invalid: Set<string>,
  failures: RecoveryFailure[],
): ReadonlyMap<string, StoredHistory> {
  const rows = read(db, `Stored ${domain} events could not be read.`, () => db.prepare(
    "SELECT owner_id, seq, project_id, payload FROM events WHERE domain = ? ORDER BY owner_id, seq",
  ).all(domain));
  const owners = new Map<string, { projectId: string; events: unknown[] }>();
  for (const row of rows) {
    const ownerId = row.owner_id;
    const projectId = row.project_id;
    if (typeof ownerId !== "string" || typeof projectId !== "string") {
      throw new StorageError("invalid-record", `Stored ${domain} event has no recoverable Project owner.`);
    }
    const history = owners.get(ownerId) ?? { projectId, events: [] };
    if (projectId !== history.projectId) {
      markInvalid(invalid, failures, domain, projectId, ownerId, `Stored ${domain} history changes Project owner.`);
      markInvalid(invalid, failures, domain, history.projectId, ownerId, `Stored ${domain} history changes Project owner.`);
    }
    if (typeof row.seq !== "number" || row.seq !== history.events.length + 1) {
      markInvalid(
        invalid,
        failures,
        domain,
        projectId,
        ownerId,
        `Stored ${domain} sequence is not contiguous.`,
        typeof row.seq === "number" ? row.seq : undefined,
      );
      continue;
    }
    if (typeof row.payload !== "string") {
      markInvalid(invalid, failures, domain, projectId, ownerId, `Stored ${domain} payload is not text.`);
      continue;
    }
    try {
      history.events.push(JSON.parse(row.payload));
    } catch (error: unknown) {
      markInvalid(invalid, failures, domain, projectId, ownerId, reason(error), row.seq);
      continue;
    }
    owners.set(ownerId, history);
  }
  return new Map([...owners].map(([ownerId, history]) => [ownerId, history]));
}

function readBindings(
  db: DatabaseSync,
  invalid: Set<string>,
  failures: RecoveryFailure[],
): readonly WorkspaceBindingRecord[] {
  const rows = read(db, "Stored Workspace bindings could not be read.", () => db.prepare(
    "SELECT project_id, root FROM workspace_bindings ORDER BY project_id",
  ).all());
  const bindings: WorkspaceBindingRecord[] = [];
  for (const row of rows) {
    if (typeof row.project_id !== "string") {
      throw new StorageError("invalid-record", "Stored Workspace binding has no recoverable Project owner.");
    }
    if (typeof row.root !== "string") {
      markInvalid(invalid, failures, "workspace", row.project_id, row.project_id, "Stored Workspace binding has an invalid root.");
      continue;
    }
    bindings.push({ projectId: row.project_id, root: row.root });
  }
  return bindings;
}

function recoveryContext(
  projects: ReadonlyMap<string, ReturnType<typeof projectProject>>,
  nodes: ReadonlyMap<string, ReturnType<typeof projectNode>>,
): ResourceHistoryContext {
  return {
    projects: { get: (projectId: string) => projects.get(projectId) },
    nodes: { get: (nodeId: string) => nodes.get(nodeId) },
  };
}

function markInvalid(
  invalid: Set<string>,
  failures: RecoveryFailure[],
  domain: EventDomain | "workspace",
  projectId: string,
  ownerId: string,
  message: string,
  sequence?: number,
): void {
  invalid.add(projectId);
  failures.push({ projectId, domain, ownerId, ...(typeof sequence === "number" ? { sequence } : {}), reason: message });
}

function isRecoverable(error: unknown): boolean {
  return error instanceof RecoveryError
    || error instanceof ProjectError
    || error instanceof NodeError
    || error instanceof RoadmapError
    || error instanceof MailboxError
    || error instanceof ResourceError
    || error instanceof SessionError;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : "Recovery validation failed.";
}

function read<T>(db: DatabaseSync, message: string, operation: () => T): T {
  try {
    return operation();
  } catch (error: unknown) {
    throw new StorageError("storage-unavailable", message, { cause: error });
  }
}
