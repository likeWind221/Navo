import { randomUUID } from "node:crypto";
import { Service } from "cordis";
import type { Context } from "cordis";
import { createEventId, createProjectId, createSessionId } from "../brand/ids.js";
import type { ProjectId, SessionId } from "../brand/ids.js";
import { StorageError } from "../storage/errors.js";
import type { ProjectEvent } from "./events.js";
import { ProjectError } from "./errors.js";
import { PROJECT_GOAL_MAX_CHARS } from "./model.js";
import type { ProjectSnapshot } from "./model.js";
import { projectProject } from "./projector.js";

export class ProjectStore extends Service {
  static inject = ["storage"];

  private readonly histories = new Map<ProjectId, readonly ProjectEvent[]>();

  constructor(ctx: Context) {
    super(ctx, "projects");
    for (const [projectId, history] of ctx.storage.loadEvents("project")) {
      try {
        this.restore(createProjectId(projectId), history);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : "unknown failure";
        throw new StorageError("invalid-record", `Stored project history ${projectId} is invalid: ${reason}`, {
          cause: error,
        });
      }
    }
  }

  create(input: CreateProjectInput): ProjectSnapshot {
    const projectId = createProjectId(randomUUID());
    const event: ProjectEvent = {
      ...this.header(projectId, 1),
      type: "project-created",
      data: { name: input.name, goal: input.goal, mainSessionId: createSessionId(randomUUID()) },
    };
    const { snapshot, events } = this.validate(projectId, [event]);
    this.commit(projectId, events, 1);
    return snapshot;
  }

  get(projectId: ProjectId): ProjectSnapshot | undefined {
    return projectProject(projectId, this.getEvents(projectId));
  }

  list(): readonly ProjectSnapshot[] {
    return Object.freeze([...this.histories.keys()].map(projectId => this.get(projectId)!));
  }

  getByMainSession(sessionId: SessionId): ProjectSnapshot | undefined {
    for (const projectId of this.histories.keys()) {
      const snapshot = this.get(projectId)!;
      if (snapshot.mainSessionId === sessionId) return snapshot;
    }
    return undefined;
  }

  getEvents(projectId: ProjectId): readonly ProjectEvent[] {
    return this.histories.get(projectId) ?? Object.freeze([]);
  }

  restore(projectId: ProjectId, history: readonly unknown[]): ProjectSnapshot {
    const { snapshot, events } = this.validate(projectId, history);
    this.histories.set(projectId, events);
    return snapshot;
  }

  archive(projectId: ProjectId, reason: string): ProjectSnapshot {
    return this.append(projectId, { type: "project-archived", data: { reason } });
  }

  reopen(projectId: ProjectId, reason: string): ProjectSnapshot {
    return this.append(projectId, { type: "project-reopened", data: { reason } });
  }

  setGoal(projectId: ProjectId, goal: string): ProjectSnapshot {
    if (!goal.trim() || goal.length > PROJECT_GOAL_MAX_CHARS) {
      throw new ProjectError(
        "invalid-goal",
        `Project goal must be non-blank text of at most ${PROJECT_GOAL_MAX_CHARS} characters.`,
      );
    }
    if (this.get(projectId)?.status === "archived") {
      throw new ProjectError("project-unavailable", "Cannot set the goal of an archived Project.");
    }
    return this.append(projectId, { type: "project-goal-set", data: { goal } });
  }

  private append(projectId: ProjectId, change: ProjectChange): ProjectSnapshot {
    const current = this.get(projectId);
    if (current === undefined) {
      throw new ProjectError("project-not-found", "Project was not found.");
    }
    const event = Object.freeze({
      ...this.header(projectId, current.revision + 1),
      type: change.type,
      data: Object.freeze({ ...change.data }),
    }) as ProjectEvent;
    const events = Object.freeze([...this.getEvents(projectId), event]);
    const next = projectProject(projectId, events)!;
    this.commit(projectId, events, event.revision);
    return next;
  }

  private commit(projectId: ProjectId, events: readonly ProjectEvent[], firstSeq: number): void {
    this.ctx.storage.write(tx => tx.appendEvents({
      domain: "project",
      ownerId: projectId,
      projectId,
      firstSeq,
      events: events.slice(firstSeq - 1),
    }), () => {
      this.histories.set(projectId, events);
      this.ctx.emit("project/changed", projectId);
    });
  }

  private validate(projectId: ProjectId, history: readonly unknown[]): ValidatedHistory {
    if (this.histories.has(projectId)) {
      throw new ProjectError("project-already-exists", "Cannot overwrite an existing Project.");
    }
    const snapshot = projectProject(projectId, history);
    if (snapshot === undefined) {
      throw new ProjectError("invalid-event-stream", "Cannot restore an empty Project history.");
    }
    if (this.getByMainSession(snapshot.mainSessionId) !== undefined) {
      throw new ProjectError("session-already-owned", "Main Session already belongs to a Project.");
    }
    const events = history.map(raw => {
      const event = raw as ProjectEvent;
      return Object.freeze({
        version: event.version,
        id: event.id,
        projectId: event.projectId,
        revision: event.revision,
        timestamp: event.timestamp,
        type: event.type,
        data: Object.freeze(freezeData(event)),
      }) as ProjectEvent;
    });
    return { snapshot, events: Object.freeze(events) };
  }

  private header(projectId: ProjectId, revision: number) {
    return {
      version: 1 as const,
      id: createEventId(randomUUID()),
      projectId,
      revision,
      timestamp: new Date().toISOString(),
    };
  }
}

interface ValidatedHistory {
  readonly snapshot: ProjectSnapshot;
  readonly events: readonly ProjectEvent[];
}

export interface CreateProjectInput {
  readonly name: string;
  readonly goal: string | null;
}

type ProjectChange<TEvent = Exclude<ProjectEvent, { type: "project-created" }>> =
  TEvent extends ProjectEvent ? Pick<TEvent, "type" | "data"> : never;

function freezeData(event: ProjectEvent): ProjectEvent["data"] {
  switch (event.type) {
    case "project-created":
      return { name: event.data.name, goal: event.data.goal, mainSessionId: event.data.mainSessionId };
    case "project-goal-set":
      return { goal: event.data.goal };
    default:
      return { reason: event.data.reason };
  }
}

declare module "cordis" {
  interface Context {
    projects: ProjectStore;
  }
}
