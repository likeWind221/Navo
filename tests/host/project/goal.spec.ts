import { describe, expect, it } from "vitest";

import type { AgentTurnV2Event, ProjectFollowV1 } from "../../../rpc/index.js";
import { projectCreateMethod, projectFollowMethod, projectGetMethod, projectTurnMethod } from "../../../rpc/index.js";
import { createProjectId } from "../../../src/brand/ids.js";
import { SET_PROJECT_GOAL_TOOL_NAME } from "../../../src/tools/builtins/project/goal.js";
import { WRITE_ROADMAP_TOOL_NAME } from "../../../src/tools/builtins/roadmap/write-roadmap.js";
import { modelResponse } from "../../helpers/runtime.js";
import { toolCall } from "../../helpers/tools.js";
import { call, host, workspace } from "./helpers.js";

const plan = {
  reason: "User agreed to the restated goal",
  nodes: [{
    key: "survey", kind: "work", title: "Survey", goal: "Collect sources",
    done_when: ["Sources listed"], required: true, depends_on: [],
  }],
};

async function collect(stream: AsyncIterable<AgentTurnV2Event>): Promise<AgentTurnV2Event[]> {
  const events: AgentTurnV2Event[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("Kernel Host Project goal confirmation", () => {
  it("creates without a goal, records the agreed goal before planning and then locks it", async () => {
    const { ctx, client, adapter } = await host([
      modelResponse([toolCall("early", WRITE_ROADMAP_TOOL_NAME, plan)], "tool-calls"),
      modelResponse([toolCall("goal", SET_PROJECT_GOAL_TOOL_NAME, { goal: "  Survey agent memory  " })], "tool-calls"),
      modelResponse([toolCall("plan", WRITE_ROADMAP_TOOL_NAME, plan)], "tool-calls"),
      modelResponse([{ type: "text", text: "Planned." }]),
      modelResponse([toolCall("late", SET_PROJECT_GOAL_TOOL_NAME, { goal: "Something else" })], "tool-calls"),
      modelResponse([{ type: "text", text: "Goal is locked." }]),
    ]);
    const created = await call(client, projectCreateMethod, { name: "Draft", goal: null, workspaceRoot: await workspace() });
    expect(created).toMatchObject({ goal: null, revision: 1 });

    const follow = new AbortController();
    const frames = client.stream(projectFollowMethod, { projectId: created.projectId }, { signal: follow.signal })
      [Symbol.asyncIterator]();
    const next = async (): Promise<ProjectFollowV1> => (await frames.next()).value as ProjectFollowV1;
    expect((await next()).detail.project).toMatchObject({ goal: null, revision: 1 });

    const first = await collect(client.stream(projectTurnMethod, {
      projectId: created.projectId, requestId: "agree", text: "Yes, plan it.", target: { kind: "main" },
    }));
    expect(first.at(-1)?.type).toBe("turn-completed");
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain("goal is not confirmed yet");
    expect(JSON.stringify(adapter.requests[0]?.messages)).toContain("not yet confirmed");

    let frame = await next();
    while (frame.detail.project.goal === null) frame = await next();
    expect(frame.detail.project).toMatchObject({ goal: "Survey agent memory", revision: 2 });
    const detail = await call(client, projectGetMethod, { projectId: created.projectId });
    expect(detail.project).toMatchObject({ goal: "Survey agent memory", revision: 2 });
    expect(detail.roadmap?.nodes.map(node => node.title)).toEqual(["Survey"]);

    await collect(client.stream(projectTurnMethod, {
      projectId: created.projectId, requestId: "change", text: "Change the goal", target: { kind: "main" },
    }));
    expect(JSON.stringify(adapter.requests[5]?.messages)).toContain("goal is locked");
    expect(ctx.projects.getEvents(createProjectId(created.projectId)).map(event => event.type))
      .toEqual(["project-created", "project-goal-set"]);
    expect((await call(client, projectGetMethod, { projectId: created.projectId })).project.goal)
      .toBe("Survey agent memory");

    follow.abort();
    await frames.next().catch(() => undefined);
  });
});
