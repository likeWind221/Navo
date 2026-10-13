import type { DatabaseSync } from "node:sqlite";

import { createNodeId, createProjectId } from "../brand/ids.js";
import { projectNode } from "../node/projector.js";
import type { NodeEvent } from "../node/events.js";
import { parseMailboxHistory } from "../mailbox/history.js";
import { projectProject } from "../project/projector.js";
import { projectRoadmap } from "../roadmap/projector.js";
import type { RoadmapEvent } from "../roadmap/events.js";
import { parseResourceHistory } from "../resource/history.js";
import type { StoredHistory, EventDomain, WorkspaceBindingRecord } from "./database.js";
import { StorageError } from "./errors.js";

export interface RecoveryPlan {
  readonly validProjectIds: ReadonlySet<string>;
  readonly events: ReadonlyMap<EventDomain, ReadonlyMap<string, StoredHistory>>;
  readonly workspaceBindings: readonly WorkspaceBindingRecord[];
}

export function buildRecoveryPlan(db: DatabaseSync): RecoveryPlan {
  const invalid = new Set<string>();
  const events = new Map<EventDomain, ReadonlyMap<string, StoredHistory>>();
  const domains: readonly EventDomain[] = ["project", "node", "roadmap", "mailbox", "resource"];

  for (const domain of domains) {
    events.set(domain, readHistories(db, domain, invalid));
  }

  const projects = events.get("project")!;
  const projectSnapshots = new Map<string, ReturnType<typeof projectProject>>();
  const mainSessions = new Map<string, string>();
  for (const [projectId, history] of projects) {
    try {
      if (history.projectId !== projectId) throw new Error("Project owner does not match its history.");
      const snapshot = projectProject(createProjectId(projectId), history.events);
      if (snapshot === undefined) throw new Error("Project history is empty.");
      const owner = mainSessions.get(snapshot.mainSessionId);
      if (owner !== undefined) {
        invalid.add(owner);
        invalid.add(projectId);
      } else {
        mainSessions.set(snapshot.mainSessionId, projectId);
      }
      projectSnapshots.set(projectId, snapshot);
    } catch {
      invalid.add(projectId);
    }
  }

  const bindings = readBindings(db, invalid);
  const boundProjects = new Set<string>();
  const boundRoots = new Set<string>();
  const validBindings: WorkspaceBindingRecord[] = [];
  for (const binding of bindings) {
    if (!projectSnapshots.has(binding.projectId) || invalid.has(binding.projectId)) {
      invalid.add(binding.projectId);
      continue;
    }
    if (boundProjects.has(binding.projectId) || boundRoots.has(binding.root)) {
      invalid.add(binding.projectId);
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
        throw new Error("Node owner does not match its history.");
      }
      if (!projectSnapshots.has(history.projectId) || invalid.has(history.projectId)) {
        throw new Error("Node references an unavailable Project.");
      }
      if (snapshot.sessionId !== undefined) {
        const owner = sessions.get(snapshot.sessionId);
        if (owner !== undefined) throw new Error("Session belongs to multiple owners.");
        sessions.set(snapshot.sessionId, history.projectId);
      }
      nodeSnapshots.set(nodeId, snapshot);
    } catch {
      invalid.add(history.projectId);
      nodeSnapshots.delete(nodeId);
    }
  }

  const roadmap = events.get("roadmap")!;
  for (const [projectId, history] of roadmap) {
    try {
      if (history.projectId !== projectId || !projectSnapshots.has(projectId) || invalid.has(projectId)) {
        throw new Error("Roadmap references an unavailable Project.");
      }
      const catalog = [...nodeSnapshots.values()]
        .filter(snapshot => snapshot?.node.projectId === projectId)
        .map(snapshot => snapshot!.node);
      if (!projectRoadmap(createProjectId(projectId), history.events as readonly RoadmapEvent[], catalog)) {
        throw new Error("Roadmap history is empty.");
      }
    } catch {
      invalid.add(projectId);
    }
  }

  const mailbox = events.get("mailbox")!;
  for (const [projectId, history] of mailbox) {
    try {
      if (history.projectId !== projectId || !projectSnapshots.has(projectId) || invalid.has(projectId)) {
        throw new Error("Mailbox references an unavailable Project.");
      }
      parseMailboxHistory(
        createProjectId(projectId),
        history.events,
        projectSnapshots,
        nodeSnapshots,
      );
    } catch {
      invalid.add(projectId);
    }
  }

  const resources = events.get("resource")!;
  const resourceEvents = new Map<string, string>();
  const resourceIds = new Map<string, string>();
  for (const [projectId, history] of resources) {
    try {
      if (history.projectId !== projectId || !projectSnapshots.has(projectId) || invalid.has(projectId)) {
        throw new Error("Resource references an unavailable Project.");
      }
      const parsed = parseResourceHistory(
        recoveryContext(projectSnapshots, nodeSnapshots),
        createProjectId(projectId),
        history.events,
      );
      for (const event of parsed) {
        const eventOwner = resourceEvents.get(event.id);
        if (eventOwner !== undefined) {
          invalid.add(eventOwner);
          invalid.add(projectId);
        } else {
          resourceEvents.set(event.id, projectId);
        }
        const resourceOwner = resourceIds.get(event.resourceId);
        if (resourceOwner !== undefined && resourceOwner !== projectId) {
          invalid.add(resourceOwner);
          invalid.add(projectId);
        } else {
          resourceIds.set(event.resourceId, projectId);
        }
      }
    } catch {
      invalid.add(projectId);
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
  });
}

function readHistories(
  db: DatabaseSync,
  domain: EventDomain,
  invalid: Set<string>,
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
    if (projectId !== history.projectId) invalid.add(projectId), invalid.add(history.projectId);
    if (typeof row.seq !== "number" || row.seq !== history.events.length + 1) {
      invalid.add(projectId);
      continue;
    }
    if (typeof row.payload !== "string") {
      invalid.add(projectId);
      continue;
    }
    try {
      history.events.push(JSON.parse(row.payload));
    } catch {
      invalid.add(projectId);
      continue;
    }
    owners.set(ownerId, history);
  }
  return new Map([...owners].map(([ownerId, history]) => [ownerId, history]));
}

function readBindings(
  db: DatabaseSync,
  invalid: Set<string>,
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
      invalid.add(row.project_id);
      continue;
    }
    bindings.push({ projectId: row.project_id, root: row.root });
  }
  return bindings;
}

function recoveryContext(
  projects: ReadonlyMap<string, unknown>,
  nodes: ReadonlyMap<string, { readonly node: { readonly projectId: string; readonly kind: string } } | undefined>,
) {
  return {
    projects: { get: (projectId: string) => projects.get(projectId) },
    nodes: { get: (nodeId: string) => nodes.get(nodeId) },
  } as never;
}

function read<T>(db: DatabaseSync, message: string, operation: () => T): T {
  try {
    return operation();
  } catch (error: unknown) {
    throw new StorageError("storage-unavailable", message, { cause: error });
  }
}
