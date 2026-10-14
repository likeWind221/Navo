import type { DatabaseSync } from "node:sqlite";

import { Service } from "cordis";
import type { Context } from "cordis";

import { StorageError } from "./errors.js";
import { planInterruptionRepair } from "./interruption.js";
import { buildRecoveryPlan } from "./recovery.js";
import type { RecoveryPlan } from "./recovery.js";
import { openDatabase } from "./schema.js";

export class StorageService extends Service {
  private readonly db: DatabaseSync;
  readonly recovery: RecoveryPlan;
  private pending: (() => void)[] | undefined;
  private readonly transaction: StorageTransaction;

  constructor(ctx: Context, config: StorageConfig) {
    super(ctx, "storage");
    this.db = openDatabase(config.path);
    this.ctx.effect(() => () => {
      if (this.db.isOpen) this.db.close();
    }, "storage.lifecycle");
    try {
      this.transaction = createTransaction(this.db);
      const recovery = buildRecoveryPlan(this.db);
      const repair = planInterruptionRepair(recovery);
      this.recovery = repair === undefined
        ? recovery
        : this.commit(() => repair.commit(this.transaction));
    } catch (error: unknown) {
      if (this.db.isOpen) this.db.close();
      throw error;
    }
  }

  write(persist: (tx: StorageTransaction) => void, apply: () => void): void {
    if (this.pending !== undefined) {
      persist(this.transaction);
      this.pending.push(apply);
      return;
    }
    this.commit(() => persist(this.transaction));
    apply();
  }

  atomic<T>(work: () => T): T {
    if (this.pending !== undefined) return work();
    const pending: (() => void)[] = [];
    this.pending = pending;
    let result: T;
    try {
      result = this.commit(work);
    } finally {
      this.pending = undefined;
    }
    for (const apply of pending) apply();
    return result;
  }

  loadEvents<T extends EventDomain>(domain: T): ReadonlyMap<string, StoredHistory<T extends "session" ? string | null : string>>;
  loadEvents(domain: EventDomain): ReadonlyMap<string, StoredHistory<string | null>> {
    const rows = read("Stored events could not be read.", () => this.db.prepare(
      "SELECT owner_id, seq, project_id, payload FROM events WHERE domain = ? ORDER BY owner_id, seq",
    ).all(domain));
    const owners = new Map<string, { readonly projectId: string | null; readonly events: unknown[] }>();
    for (const row of rows) {
      const ownerId = row.owner_id;
      const seq = row.seq;
      const where = `${domain} event ${String(ownerId)}#${String(seq)}`;
      const projectId = row.project_id;
      if (typeof ownerId !== "string" || (typeof projectId !== "string" && !(domain === "session" && projectId === null)) || typeof row.payload !== "string") {
        throw new StorageError("invalid-record", `Stored ${where} has an invalid shape.`);
      }
      const history = owners.get(ownerId) ?? { projectId, events: [] };
      if (seq !== history.events.length + 1) {
        throw new StorageError("invalid-record", `Stored ${where} breaks the contiguous sequence.`);
      }
      if (projectId !== history.projectId) {
        throw new StorageError("invalid-record", `Stored ${where} belongs to a different Project than earlier events.`);
      }
      try {
        history.events.push(JSON.parse(row.payload));
      } catch (error: unknown) {
        throw new StorageError("invalid-record", `Stored ${where} is not valid JSON.`, { cause: error });
      }
      owners.set(ownerId, history);
    }
    return owners;
  }

  loadWorkspaceBindings(): readonly WorkspaceBindingRecord[] {
    const rows = read("Stored Workspace bindings could not be read.", () => this.db.prepare(
      "SELECT project_id, root FROM workspace_bindings ORDER BY project_id",
    ).all());
    return rows.map(row => {
      if (typeof row.project_id !== "string" || typeof row.root !== "string") {
        throw new StorageError("invalid-record", "Stored Workspace binding has an invalid shape.");
      }
      return { projectId: row.project_id, root: row.root };
    });
  }

  private commit<T>(work: () => T): T {
    run(this.db, "BEGIN IMMEDIATE");
    try {
      const result = work();
      run(this.db, "COMMIT");
      return result;
    } catch (error: unknown) {
      if (this.db.isOpen && this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

export interface StorageConfig {
  readonly path: string;
}

export interface StorageTransaction {
  appendEvents(append: EventAppend): void;
  hasEvents(domain: EventDomain, ownerId: string): boolean;
  bindWorkspace(binding: WorkspaceBindingRecord): void;
  unbindWorkspace(projectId: string): void;
}

export type EventAppend = EventAppendFields & (
  | { readonly domain: "session"; readonly projectId: string | null }
  | { readonly domain: ProjectEventDomain; readonly projectId: string }
);

interface EventAppendFields {
  readonly ownerId: string;
  readonly firstSeq: number;
  readonly events: readonly unknown[];
}

export type EventDomain = ProjectEventDomain | "session";
export type ProjectEventDomain = "project" | "node" | "roadmap" | "mailbox" | "resource";

export interface StoredHistory<TProjectId = string> {
  readonly projectId: TProjectId;
  readonly events: readonly unknown[];
}

export interface WorkspaceBindingRecord {
  readonly projectId: string;
  readonly root: string;
}

function createTransaction(db: DatabaseSync): StorageTransaction {
  return {
    appendEvents({ domain, ownerId, projectId, firstSeq, events }) {
      if ((projectId === null && domain !== "session") || (projectId !== null && (typeof projectId !== "string" || !projectId.trim()))) {
        throw new StorageError("invalid-record", "Stored events require a valid Project owner or a standalone Session.");
      }
      const owner = write(() => db.prepare(
        "SELECT project_id FROM events WHERE domain = ? AND owner_id = ? LIMIT 1",
      ).get(domain, ownerId));
      if (owner !== undefined && owner.project_id !== projectId) {
        throw new StorageError("invalid-record", `Stored ${domain} history for ${ownerId} cannot change its Project owner.`);
      }
      const last = write(() => db.prepare(
        "SELECT max(seq) AS seq FROM events WHERE domain = ? AND owner_id = ?",
      ).get(domain, ownerId)?.seq);
      if ((typeof last === "number" ? last : 0) + 1 !== firstSeq) {
        throw new StorageError(
          "sequence-conflict",
          `Stored ${domain} history for ${ownerId} does not end before sequence ${firstSeq}.`,
        );
      }
      const insert = write(() => db.prepare(
        "INSERT INTO events (domain, owner_id, seq, project_id, payload) VALUES (?, ?, ?, ?, ?)",
      ));
      events.forEach((event, index) => {
        write(() => insert.run(domain, ownerId, firstSeq + index, projectId, JSON.stringify(event)));
      });
    },
    hasEvents(domain, ownerId) {
      return write(() => db.prepare(
        "SELECT 1 AS found FROM events WHERE domain = ? AND owner_id = ? LIMIT 1",
      ).get(domain, ownerId)) !== undefined;
    },
    bindWorkspace({ projectId, root }) {
      write(() => db.prepare(
        "INSERT INTO workspace_bindings (project_id, root) VALUES (?, ?)",
      ).run(projectId, root));
    },
    unbindWorkspace(projectId) {
      write(() => db.prepare(
        "DELETE FROM workspace_bindings WHERE project_id = ?",
      ).run(projectId));
    },
  };
}

function run(db: DatabaseSync, statement: string): void {
  write(() => db.exec(statement));
}

function write<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error: unknown) {
    throw new StorageError("write-failed", "Navo database write failed.", { cause: error });
  }
}

function read<T>(message: string, operation: () => T): T {
  try {
    return operation();
  } catch (error: unknown) {
    throw new StorageError("storage-unavailable", message, { cause: error });
  }
}

declare module "cordis" {
  interface Context {
    storage: StorageService;
  }
}
