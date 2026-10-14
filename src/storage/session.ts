import type { DatabaseSync } from "node:sqlite";

import { createSessionId } from "../brand/ids.js";
import { SessionError } from "../session/errors.js";
import { parseSessionHistory } from "../session/history.js";
import type { StoredHistory } from "./database.js";
import { StorageError } from "./errors.js";
import type { RecoveryFailure } from "./recovery.js";

export interface SessionRecovery {
  readonly histories: ReadonlyMap<string, StoredHistory<string | null>>;
  readonly unavailable: Set<string>;
}

export function recoverSessions(
  db: DatabaseSync,
  projects: ReadonlySet<string>,
  owners: ReadonlyMap<string, ReadonlySet<string>>,
  invalidProjects: Set<string>,
  failures: RecoveryFailure[],
): SessionRecovery {
  let rows;
  try {
    rows = db.prepare(
      "SELECT owner_id, seq, project_id, payload FROM events WHERE domain = 'session' ORDER BY owner_id, seq",
    ).all();
  } catch (error: unknown) {
    throw new StorageError("storage-unavailable", "Stored Session events could not be read.", { cause: error });
  }
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    if (typeof row.owner_id !== "string") {
      throw new StorageError("invalid-record", "Stored Session has no recoverable identity.");
    }
    const group = grouped.get(row.owner_id) ?? [];
    group.push(row);
    grouped.set(row.owner_id, group);
  }
  const histories = new Map<string, StoredHistory<string | null>>();
  const unavailable = new Set<string>();
  for (const [sessionId, group] of grouped) {
    const projectIds = new Set(owners.get(sessionId));
    for (const row of group) {
      if (typeof row.project_id === "string") projectIds.add(row.project_id);
      else if (row.project_id !== null) {
        throw new StorageError("invalid-record", `Stored Session '${sessionId}' has no recoverable owner.`);
      }
    }
    let sequence: number | undefined;
    try {
      if (!sessionId.trim()) throw new SessionError("invalid-history", "Session identity is empty.");
      const projectId = group[0]!.project_id as string | null;
      const bindings = owners.get(sessionId);
      if (projectId === null) {
        if (bindings !== undefined) throw new SessionError("invalid-history", "Standalone Session uses a Project Session identity.");
      } else if (!projectId.trim() || !projects.has(projectId) || invalidProjects.has(projectId)
          || bindings?.size !== 1 || !bindings.has(projectId)) {
        throw new SessionError("invalid-history", "Session does not belong to an available Main or Node in its Project.");
      }
      const events = group.map((row, index) => {
        sequence = typeof row.seq === "number" ? row.seq : undefined;
        if (row.project_id !== projectId) throw new SessionError("invalid-history", "Session changes Project owner.");
        if (row.seq !== index + 1) throw new SessionError("invalid-history", "Session sequence is not contiguous.");
        if (typeof row.payload !== "string") throw new SessionError("invalid-history", "Session payload is not text.");
        try {
          return JSON.parse(row.payload) as unknown;
        } catch {
          throw new SessionError("invalid-history", "Session payload is not valid JSON.");
        }
      });
      sequence = undefined;
      histories.set(sessionId, { projectId, events: parseSessionHistory(createSessionId(sessionId), events) });
    } catch (error: unknown) {
      if (!(error instanceof SessionError)) throw error;
      unavailable.add(sessionId);
      const details = { domain: "session" as const, ownerId: sessionId,
        ...(sequence === undefined ? {} : { sequence }), reason: error.message };
      for (const projectId of projectIds) {
        invalidProjects.add(projectId);
        failures.push({ kind: "project", projectId, ...details });
      }
      if (group.some(row => row.project_id === null)) {
        failures.push({ kind: "session", sessionId, ...details });
      }
    }
  }
  for (const [sessionId, projectIds] of owners) {
    if ([...projectIds].some(projectId => invalidProjects.has(projectId))) unavailable.add(sessionId);
  }
  for (const [sessionId, history] of histories) {
    if (history.projectId !== null && invalidProjects.has(history.projectId)) unavailable.add(sessionId);
    if (unavailable.has(sessionId)) histories.delete(sessionId);
  }
  return { histories, unavailable };
}
