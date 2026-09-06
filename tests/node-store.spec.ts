import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import {
  createEventId,
  createNodeId,
  createSessionId,
} from "../src/brand/ids.js";
import { NodeError } from "../src/node/errors.js";
import type {
  NodeCreatedEvent,
  NodeEvent,
  SessionBoundEvent,
} from "../src/node/events.js";
import { projectNode } from "../src/node/projector.js";
import { NodeStore } from "../src/node/store.js";

const contexts = new Set<Context>();

function createContext(): Context {
  const ctx = new Context();
  contexts.add(ctx);
  return ctx;
}

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
});

describe("NodeStore", () => {
  it("creates an immutable revision-one Node detached from its input", async () => {
    const ctx = createContext();
    await ctx.plugin(NodeStore);
    const criterion = "Explain a generic constraint";
    const capability = {
      title: "TypeScript generics",
      description: "Use generic types safely",
      successCriteria: [criterion],
    };
    const source = { reference: "https://example.test/generics", label: "Guide" };

    const snapshot = ctx.nodes.create({ capability, sources: [source] });
    capability.successCriteria[0] = "mutated";
    source.label = "mutated";

    expect(snapshot.revision).toBe(1);
    expect(snapshot.sessionId).toBeUndefined();
    expect(snapshot.node.capability.successCriteria).toEqual([criterion]);
    expect(snapshot.node.sources[0]?.label).toBe("Guide");
    expect(snapshot.node.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.node.capability.successCriteria)).toBe(true);
    expect(ctx.nodes.getEvents(snapshot.node.id)).toHaveLength(1);
  });

  it("returns undefined for unknown Node and empty event history", async () => {
    const ctx = createContext();
    await ctx.plugin(NodeStore);
    const missing = createNodeId("missing-node");

    expect(ctx.nodes.get(missing)).toBeUndefined();
    expect(ctx.nodes.getEvents(missing)).toEqual([]);
  });

  it("binds one Session and supports reverse lookup", async () => {
    const ctx = createContext();
    await ctx.plugin(NodeStore);
    const created = ctx.nodes.create({ capability: capability() });
    const sessionId = createSessionId("node-session");

    const bound = ctx.nodes.bindSession(created.node.id, sessionId);

    expect(bound).toMatchObject({ revision: 2, sessionId });
    expect(ctx.nodes.getBySession(sessionId)?.node.id).toBe(created.node.id);
    expect(ctx.nodes.getEvents(created.node.id).map((event) => event.type))
      .toEqual(["node-created", "session-bound"]);
  });

  it("rejects rebinding a Node and sharing a Session across Nodes", async () => {
    const ctx = createContext();
    await ctx.plugin(NodeStore);
    const first = ctx.nodes.create({ capability: capability("First") });
    const second = ctx.nodes.create({ capability: capability("Second") });
    const sessionId = createSessionId("exclusive-session");
    ctx.nodes.bindSession(first.node.id, sessionId);

    expect(() => ctx.nodes.bindSession(first.node.id, createSessionId("other")))
      .toThrow(expect.objectContaining({
        name: "NodeError",
        code: "node-already-bound",
      }));
    expect(() => ctx.nodes.bindSession(second.node.id, sessionId))
      .toThrow(expect.objectContaining({
        name: "NodeError",
        code: "session-already-bound",
      }));
    expect(ctx.nodes.getEvents(first.node.id)).toHaveLength(2);
    expect(ctx.nodes.getEvents(second.node.id)).toHaveLength(1);
  });

  it("rejects binding an unknown Node with a classified error", async () => {
    const ctx = createContext();
    await ctx.plugin(NodeStore);

    expect(() => ctx.nodes.bindSession(
      createNodeId("unknown"),
      createSessionId("unused"),
    )).toThrow(expect.objectContaining({
      name: "NodeError",
      code: "node-not-found",
    }));
  });

  it("publishes only committed events and isolates observer failures", async () => {
    const ctx = createContext();
    await ctx.plugin(NodeStore);
    const observed: string[] = [];
    let committedBeforePublish = false;

    ctx.on("node/event", (event) => {
      observed.push("healthy");
      committedBeforePublish = ctx.nodes.getEvents(event.nodeId).at(-1) === event;
    });
    ctx.on("node/event", () => {
      observed.push("throwing");
      throw new Error("observer failed");
    });
    ctx.on("node/event", async () => {
      observed.push("rejecting");
      throw new Error("async observer failed");
    });

    let snapshot: ReturnType<NodeStore["create"]> | undefined;
    expect(() => {
      snapshot = ctx.nodes.create({ capability: capability() });
    }).not.toThrow();

    expect(committedBeforePublish).toBe(true);
    expect(observed).toEqual(["healthy", "throwing", "rejecting"]);
    expect(ctx.nodes.getEvents(snapshot!.node.id)).toHaveLength(1);
    await Promise.resolve();
    await Promise.resolve();
  });

  it("returns immutable event arrays and committed event values", async () => {
    const ctx = createContext();
    await ctx.plugin(NodeStore);
    const snapshot = ctx.nodes.create({ capability: capability() });
    const events = ctx.nodes.getEvents(snapshot.node.id);

    expect(Object.isFrozen(events)).toBe(true);
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(Object.isFrozen(events[0]?.data)).toBe(true);
    expect(() => (events as NodeEvent[]).push(events[0]!)).toThrow(TypeError);
    expect(ctx.nodes.getEvents(snapshot.node.id)).toHaveLength(1);
  });

  it("registers and releases the Cordis service", async () => {
    const ctx = createContext();
    const fiber = await ctx.plugin(NodeStore);

    expect(ctx.nodes).toBeInstanceOf(NodeStore);
    await fiber.dispose();
    expect(Reflect.get(ctx, "nodes")).toBeUndefined();
  });
});

describe("projectNode", () => {
  it("reconstructs a valid Node and returns undefined for no events", () => {
    const nodeId = createNodeId("node-valid");
    const sessionId = createSessionId("session-valid");
    const snapshot = projectNode(nodeId, [created(nodeId), bound(nodeId, sessionId)]);

    expect(snapshot).toMatchObject({ revision: 2, sessionId });
    expect(snapshot?.node.capability.title).toBe("Capability");
    expect(projectNode(nodeId, [])).toBeUndefined();
  });

  it.each(invalidStreams())("rejects $name", ({ nodeId, events }) => {
    expect(() => projectNode(nodeId, events)).toThrow(expect.objectContaining({
      name: "NodeError",
      code: "invalid-event-stream",
    } satisfies Partial<NodeError>));
  });
});

function capability(title = "Capability") {
  return {
    title,
    description: "A verifiable capability",
    successCriteria: ["Demonstrate it"],
  };
}

function created(nodeId: ReturnType<typeof createNodeId>, revision = 1): NodeCreatedEvent {
  return {
    id: createEventId(`created-${nodeId}-${revision}`),
    nodeId,
    revision,
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "node-created",
    data: { capability: capability(), sources: [] },
  };
}

function bound(
  nodeId: ReturnType<typeof createNodeId>,
  sessionId: ReturnType<typeof createSessionId>,
  revision = 2,
): SessionBoundEvent {
  return {
    id: createEventId(`bound-${nodeId}-${revision}`),
    nodeId,
    revision,
    timestamp: "2026-01-01T00:00:01.000Z",
    type: "session-bound",
    data: { sessionId },
  };
}

function invalidStreams(): readonly {
  name: string;
  nodeId: ReturnType<typeof createNodeId>;
  events: readonly NodeEvent[];
}[] {
  const nodeId = createNodeId("node-invalid");
  const other = createNodeId("node-other");
  const session = createSessionId("session-invalid");
  return [
    { name: "an event owned by another Node", nodeId, events: [created(other)] },
    { name: "a skipped revision", nodeId, events: [created(nodeId, 2)] },
    { name: "Session binding before creation", nodeId, events: [bound(nodeId, session, 1)] },
    { name: "duplicate creation", nodeId, events: [created(nodeId), created(nodeId, 2)] },
    {
      name: "duplicate Session binding",
      nodeId,
      events: [created(nodeId), bound(nodeId, session), bound(nodeId, createSessionId("second"), 3)],
    },
  ];
}
