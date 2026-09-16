import { randomUUID } from "node:crypto";
import { Service } from "cordis";
import type { Context } from "cordis";
import { createEventId, createProjectId, createSessionId } from "../brand/ids.js";
import type { ProjectId, SessionId } from "../brand/ids.js";
import type { ProjectEvent } from "./events.js";
import { ProjectError } from "./errors.js";
import type { ProjectSnapshot } from "./model.js";
import { projectProject } from "./projector.js";

export class ProjectStore extends Service {
  private readonly histories = new Map<ProjectId, readonly ProjectEvent[]>();

  constructor(ctx: Context) {
    super(ctx, "projects");
  }

  create(input: CreateProjectInput): ProjectSnapshot {
    const projectId = createProjectId(randomUUID());
    const event: ProjectEvent = {
      ...this.header(projectId, 1),
      type: "project-created",
      data: { goal: input.goal, mainSessionId: createSessionId(randomUUID()) },
    };
    return this.restore(projectId, [event]);
  }

  get(projectId: ProjectId): ProjectSnapshot | undefined {
    return projectProject(projectId, this.getEvents(projectId));
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
        data: Object.freeze(event.type === "project-created"
          ? { goal: event.data.goal, mainSessionId: event.data.mainSessionId }
          : { reason: event.data.reason }),
      }) as ProjectEvent;
    });
    this.histories.set(projectId, Object.freeze(events));
    return snapshot;
  }

  archive(projectId: ProjectId, reason: string): ProjectSnapshot {
    return this.transition(projectId, "project-archived", reason);
  }

  reopen(projectId: ProjectId, reason: string): ProjectSnapshot {
    return this.transition(projectId, "project-reopened", reason);
  }

  private transition(
    projectId: ProjectId,
    type: "project-archived" | "project-reopened",
    reason: string,
  ): ProjectSnapshot {
    const current = this.get(projectId);
    if (current === undefined) {
      throw new ProjectError("project-not-found", "Project was not found.");
    }
    const event: ProjectEvent = Object.freeze({
      ...this.header(projectId, current.revision + 1),
      type,
      data: Object.freeze({ reason }),
    });
    const events = Object.freeze([...this.getEvents(projectId), event]);
    const next = projectProject(projectId, events)!;
    this.histories.set(projectId, events);
    return next;
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

export interface CreateProjectInput {
  readonly goal: string;
}

declare module "cordis" {
  interface Context {
    projects: ProjectStore;
  }
}
