import assert from "node:assert/strict";

import type { Context } from "cordis";

import type { ProjectId, SessionId } from "../../src/brand/ids.js";
import type { ProjectSnapshot } from "../../src/project/model.js";
import { projectState } from "../longterm/evidence.js";
import { assertSessionRestart, captureSession, type CapturedSession, type SessionEvidence } from "./events.js";

export interface WorkspaceBinding {
  readonly projectId: string;
  readonly root: string;
}

export interface RestartState {
  readonly projectId: string;
  readonly project: ProjectSnapshot | null;
  readonly workspace: readonly WorkspaceBinding[];
  readonly domain: ReturnType<typeof projectState>;
  readonly sessions: readonly CapturedSession[];
}

export interface RestartEvidence {
  readonly projectId: string;
  readonly project: ProjectSnapshot | null;
  readonly workspace: readonly WorkspaceBinding[];
  readonly domain: ReturnType<typeof projectState>;
  readonly sessions: readonly SessionEvidence[];
}

export function captureRestartState(app: Context, projectId: ProjectId): RestartState {
  const workspace = app.storage.loadWorkspaceBindings()
    .filter(binding => binding.projectId === String(projectId))
    .map(binding => Object.freeze({ projectId: binding.projectId, root: binding.root }));
  return Object.freeze({
    projectId: String(projectId),
    project: app.projects.get(projectId) ?? null,
    workspace: Object.freeze(workspace),
    domain: projectState(app, projectId),
    sessions: Object.freeze(projectSessionIds(app, projectId).map(sessionId => captureSession(app, sessionId))),
  });
}

export function restartEvidence(state: RestartState): RestartEvidence {
  return Object.freeze({
    projectId: state.projectId,
    project: state.project,
    workspace: state.workspace,
    domain: state.domain,
    sessions: Object.freeze(state.sessions.map(session => session.evidence)),
  });
}

export function assertRestart(before: RestartState, after: RestartState): void {
  assert.deepEqual(after.project, before.project, "Project metadata changed across restart.");
  assert.deepEqual(after.workspace, before.workspace, "Workspace identity changed across restart.");
  assert.deepEqual(after.domain, before.domain, "Project domain state changed across restart.");
  assert.equal(after.sessions.length, before.sessions.length, "Session count changed across restart.");
  before.sessions.forEach((session, index) => {
    const current = after.sessions[index];
    assert(current !== undefined, `Session ${session.evidence.sessionId} is missing after restart.`);
    assertSessionRestart(session, current);
  });
}

function projectSessionIds(app: Context, projectId: ProjectId): readonly SessionId[] {
  const project = app.projects.get(projectId);
  if (project === undefined) return [];
  return Object.freeze([
    project.mainSessionId,
    ...app.nodes.getByProject(projectId).flatMap(node => node.sessionId === undefined ? [] : [node.sessionId]),
  ]);
}
