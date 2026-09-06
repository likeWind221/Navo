import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import {
  createExerciseId,
  createSessionId,
} from "../src/brand/ids.js";
import { toLearnerExerciseSet } from "../src/node/model.js";
import type { MaterialReplacedEvent } from "../src/node/events.js";
import { projectNode } from "../src/node/projector.js";
import { NodeStore } from "../src/node/store.js";
import {
  NODE_CONTENT_TOOL_NAMES,
  NodeContentTools,
} from "../src/node/tools.js";
import { ToolService } from "../src/tools/service.js";
import {
  createRuntime,
  disposeRuntimes,
  modelResponse,
  turnInput,
} from "./helpers/runtime.js";
import { toolCall } from "./helpers/tools.js";

const contexts = new Set<Context>();
const signal = new AbortController().signal;

async function createContentContext(loadTools = false): Promise<Context> {
  const ctx = new Context();
  contexts.add(ctx);
  await ctx.plugin(ToolService);
  await ctx.plugin(NodeStore);
  if (loadTools) await ctx.plugin(NodeContentTools);
  return ctx;
}

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
  await disposeRuntimes();
});

describe("Node content state", () => {
  it("replaces material and exercises with independent revisions", async () => {
    const ctx = await createContentContext();
    const node = createBoundNode(ctx, "content-session");
    const retainedId = createExerciseId("retained-exercise");

    ctx.nodes.replaceMaterial(node.node.id, {
      text: "Material v1",
      sources: [{ reference: "https://example.test/source" }],
    });
    ctx.nodes.replaceExerciseSet(node.node.id, {
      exercises: [exercise("Question v1", "Answer v1", retainedId)],
    });
    ctx.nodes.replaceMaterial(node.node.id, { text: "Material v2" });
    const final = ctx.nodes.replaceExerciseSet(node.node.id, {
      exercises: [
        exercise("Question v2", "Answer v2", retainedId),
        exercise("Generated id question", "Generated id answer"),
      ],
    });

    expect(final.revision).toBe(6);
    expect(final.content.material).toMatchObject({ revision: 2, text: "Material v2" });
    expect(final.content.exerciseSet?.revision).toBe(2);
    expect(final.content.exerciseSet?.exercises[0]?.id).toBe(retainedId);
    expect(final.content.exerciseSet?.exercises[1]?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(projectNode(node.node.id, ctx.nodes.getEvents(node.node.id)))
      .toEqual(final);
  });

  it("rejects invalid content atomically", async () => {
    const ctx = await createContentContext();
    const unbound = ctx.nodes.create({ capability: capability("Unbound") });
    const bound = createBoundNode(ctx, "validation-session");
    const before = ctx.nodes.getEvents(bound.node.id).length;
    const duplicate = createExerciseId("duplicate");

    expect(() => ctx.nodes.replaceMaterial(unbound.node.id, { text: "x" }))
      .toThrow(expect.objectContaining({ code: "node-session-required" }));
    expect(() => ctx.nodes.replaceMaterial(bound.node.id, { text: "   " }))
      .toThrow(expect.objectContaining({ code: "invalid-content" }));
    expect(() => ctx.nodes.replaceExerciseSet(bound.node.id, { exercises: [] }))
      .toThrow(expect.objectContaining({ code: "invalid-content" }));
    expect(() => ctx.nodes.replaceExerciseSet(bound.node.id, {
      exercises: [
        exercise("One", "Answer", duplicate),
        exercise("Two", "Answer", duplicate),
      ],
    })).toThrow(expect.objectContaining({ code: "invalid-content" }));

    expect(ctx.nodes.getEvents(bound.node.id)).toHaveLength(before);
    expect(ctx.nodes.get(bound.node.id)?.content).toEqual({});
  });

  it("rejects a non-contiguous content revision during replay", async () => {
    const ctx = await createContentContext();
    const node = createBoundNode(ctx, "corrupt-session");
    ctx.nodes.replaceMaterial(node.node.id, { text: "Valid" });
    const events = ctx.nodes.getEvents(node.node.id);
    const material = events[2] as MaterialReplacedEvent;
    const corrupt = {
      ...material,
      data: { material: { ...material.data.material, revision: 2 } },
    };

    expect(() => projectNode(node.node.id, [...events.slice(0, 2), corrupt]))
      .toThrow(expect.objectContaining({ code: "invalid-event-stream" }));
  });

  it("removes every reference answer from the learner view", () => {
    const view = toLearnerExerciseSet({
      revision: 1,
      exercises: [{
        id: createExerciseId("visible-id"),
        prompt: "Question",
        referenceAnswer: "Secret answer",
      }],
    });

    expect(view).toEqual({
      revision: 1,
      exercises: [{ id: createExerciseId("visible-id"), prompt: "Question" }],
    });
    expect("referenceAnswer" in view.exercises[0]!).toBe(false);
    expect(Object.isFrozen(view.exercises[0])).toBe(true);
  });
});

describe("Node content tool authorization", () => {
  it("registers and unloads both content tools", async () => {
    const ctx = await createContentContext();
    const owner = await ctx.plugin(NodeContentTools);

    expect(ctx.tools.schemas().map(({ name }) => name)).toEqual([
      NODE_CONTENT_TOOL_NAMES.replaceMaterial,
      NODE_CONTENT_TOOL_NAMES.replaceExerciseSet,
    ]);
    await owner.dispose();
    expect(ctx.tools.schemas()).toEqual([]);
  });

  it("updates only the Node owned by the execution Session", async () => {
    const ctx = await createContentContext(true);
    const first = createBoundNode(ctx, "owner-session");
    const second = createBoundNode(ctx, "other-session");
    const call = toolCall("material", NODE_CONTENT_TOOL_NAMES.replaceMaterial, {
      text: "Authorized material",
      sources: [],
    });

    const result = await ctx.tools.execute(call, signal, {
      sessionId: first.sessionId,
      allowedTools: [NODE_CONTENT_TOOL_NAMES.replaceMaterial],
    });
    const exercises = await ctx.tools.execute(
      toolCall("questions", NODE_CONTENT_TOOL_NAMES.replaceExerciseSet, {
        exercises: [{ prompt: "Question", referenceAnswer: "Private answer" }],
      }),
      signal,
      {
        sessionId: first.sessionId,
        allowedTools: [NODE_CONTENT_TOOL_NAMES.replaceExerciseSet],
      },
    );

    expect(result).toMatchObject({ kind: "success" });
    expect(result.block.content).toEqual([
      { type: "text", text: "Material updated to revision 1." },
    ]);
    expect(exercises.block.content).toEqual([{
      type: "text",
      text: "Exercise set updated to revision 1 with 1 exercises.",
    }]);
    expect(ctx.nodes.get(first.node.id)?.content.material?.text)
      .toBe("Authorized material");
    expect(ctx.nodes.get(first.node.id)?.content.exerciseSet?.exercises[0]?.referenceAnswer)
      .toBe("Private answer");
    expect(ctx.nodes.get(second.node.id)?.content).toEqual({});
  });

  it("rejects absent, unbound, and disallowed Session capabilities", async () => {
    const ctx = await createContentContext(true);
    const call = toolCall("exercise", NODE_CONTENT_TOOL_NAMES.replaceExerciseSet, {
      exercises: [{ prompt: "Question", referenceAnswer: "Secret" }],
    });

    const missing = await ctx.tools.execute(call, signal);
    const unbound = await ctx.tools.execute(call, signal, {
      sessionId: createSessionId("unbound-session"),
    });
    const disallowed = await ctx.tools.execute(call, signal, {
      allowedTools: [NODE_CONTENT_TOOL_NAMES.replaceMaterial],
    });

    expect(missing).toMatchObject({ kind: "failure", failure: { code: "tool-failed" } });
    expect(unbound).toMatchObject({ kind: "failure", failure: { code: "tool-failed" } });
    expect(disallowed).toMatchObject({
      kind: "failure",
      failure: { code: "tool-not-allowed" },
    });
    expect(disallowed.block.content).not.toContainEqual(
      expect.objectContaining({ text: expect.stringContaining("Secret") }),
    );
  });

  it("filters schemas and rejects unknown selections", async () => {
    const ctx = await createContentContext(true);

    expect(ctx.tools.schemas([NODE_CONTENT_TOOL_NAMES.replaceMaterial])
      .map(({ name }) => name)).toEqual([NODE_CONTENT_TOOL_NAMES.replaceMaterial]);
    expect(() => ctx.tools.schemas(["missing-tool"]))
      .toThrow(expect.objectContaining({ code: "unknown-tool-selection" }));
  });

  it("does not commit when execution is already cancelled", async () => {
    const ctx = await createContentContext(true);
    const node = createBoundNode(ctx, "cancel-session");
    const controller = new AbortController();
    controller.abort("stop");

    const result = await ctx.tools.execute(
      toolCall("cancelled", NODE_CONTENT_TOOL_NAMES.replaceMaterial, { text: "No" }),
      controller.signal,
      {
        sessionId: node.sessionId,
        allowedTools: [NODE_CONTENT_TOOL_NAMES.replaceMaterial],
      },
    );

    expect(result).toMatchObject({ kind: "failure", failure: { code: "cancelled" } });
    expect(ctx.nodes.get(node.node.id)?.content).toEqual({});
  });
});

describe("AgentRuntime tool scope", () => {
  it("shows and executes only the Turn allowlist with its Session identity", async () => {
    const call = toolCall("runtime-material", NODE_CONTENT_TOOL_NAMES.replaceMaterial, {
      text: "Runtime material",
    });
    const kit = await createRuntime([
      modelResponse([call], "tool-calls"),
      modelResponse([{ type: "text", text: "done" }]),
    ]);
    await kit.ctx.plugin(NodeStore);
    await kit.ctx.plugin(NodeContentTools);
    const input = turnInput("node-content-runtime");
    const node = kit.ctx.nodes.create({ capability: capability() });
    kit.ctx.nodes.bindSession(node.node.id, input.sessionId);

    await expect(kit.ctx.agentRuntime.runTurn({
      ...input,
      toolNames: [NODE_CONTENT_TOOL_NAMES.replaceMaterial],
    })).resolves.toMatchObject({ status: "completed", steps: 2 });

    expect(kit.adapter.requests).toHaveLength(2);
    for (const request of kit.adapter.requests) {
      expect(request.tools?.map(({ name }) => name))
        .toEqual([NODE_CONTENT_TOOL_NAMES.replaceMaterial]);
    }
    expect(kit.ctx.nodes.get(node.node.id)?.content.material?.text)
      .toBe("Runtime material");
  });
});

function capability(title = "Capability") {
  return {
    title,
    description: "A verifiable capability",
    successCriteria: ["Demonstrate it"],
  };
}

function exercise(
  prompt: string,
  referenceAnswer: string,
  id?: ReturnType<typeof createExerciseId>,
) {
  return { ...(id === undefined ? {} : { id }), prompt, referenceAnswer };
}

function createBoundNode(ctx: Context, session: string) {
  const created = ctx.nodes.create({ capability: capability(session) });
  const sessionId = createSessionId(session);
  return { ...ctx.nodes.bindSession(created.node.id, sessionId), sessionId };
}
