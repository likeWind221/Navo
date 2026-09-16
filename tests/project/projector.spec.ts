import { describe, expect, expectTypeOf, it } from "vitest";
import { createProjectId } from "../../src/brand/ids.js";
import type { NodeId, ProjectId, SessionId } from "../../src/brand/ids.js";
import { projectProject } from "../../src/project/projector.js";

const id = createProjectId("project");
const created = {
  version: 1, id: "event-1", projectId: id, revision: 1,
  timestamp: "2026-09-14T00:00:00.000Z", type: "project-created",
  data: { goal: "Goal", mainSessionId: "main-session" },
};
const archived = {
  ...created, id: "event-2", revision: 2, type: "project-archived", data: { reason: "Archive" },
};

describe("Project history validation", () => {
  it("keeps Project identity distinct at compile time", () => {
    expectTypeOf<ProjectId>().not.toEqualTypeOf<SessionId>();
    expectTypeOf<ProjectId>().not.toEqualTypeOf<NodeId>();
    expect(() => createProjectId("")).toThrow(TypeError);
    expect(projectProject(id, [])).toBeUndefined();
  });

  it.each([
    [null],
    [{ ...created, version: 2 }],
    [{ ...created, id: "" }],
    [{ ...created, projectId: "other" }],
    [{ ...created, revision: 2 }],
    [{ ...created, timestamp: "not-a-date" }],
    [{ ...created, type: "unknown" }],
    [{ ...created, data: null }],
    [{ ...created, data: { goal: " ", mainSessionId: "main" } }],
    [{ ...created, data: { goal: "Goal", mainSessionId: 1 } }],
    [{ ...archived, revision: 1 }],
    [created, { ...created, id: "event-2", revision: 2 }],
    [created, { ...archived, id: created.id }],
    [created, { ...archived, revision: 3 }],
    [created, { ...archived, type: "project-reopened" }],
    [created, { ...archived, data: { reason: "" } }],
    [created, archived, { ...archived, id: "event-3", revision: 3 }],
  ].map(history => ({ history })))("rejects malformed history %#", ({ history }) => {
    expect(() => projectProject(id, history))
      .toThrow(expect.objectContaining({ code: "invalid-event-stream" }));
  });
});
