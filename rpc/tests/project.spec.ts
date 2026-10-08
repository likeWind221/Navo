import { describe, expect, it } from "vitest";

import {
  PROJECT_MAILBOX_PAGE_MAX,
  PROJECT_GOAL_MAX_CHARS,
  PROJECT_NAME_MAX_CHARS,
  RpcError,
  StreamRpcClient,
  StreamRpcRouter,
  StreamRpcServer,
  projectCreateMethod,
  projectFollowMethod,
  projectGetMethod,
  projectListMethod,
  projectMailboxMethod,
  projectNodeReviewMethod,
  projectResourcesMethod,
  projectTurnMethod,
} from "../index.js";
import type { NodeV1, ProjectSummaryV1 } from "../index.js";
import { createTransportPair } from "./helpers/transport.js";

const summary: ProjectSummaryV1 = {
  projectId: "p", name: "Paper", goal: "Survey", workspaceRoot: "D:/work",
  status: "active", revision: 1, createdAt: "2026-10-07T00:00:00.000Z",
};
const node: NodeV1 = {
  nodeId: "n", revision: 1, kind: "work", requirement: "required", status: "idle",
  title: "Collect", description: "", acceptanceCriteria: ["Done"], controlPurpose: null,
  hasSession: false, turnActive: false, actions: { run: true, complete: true, skip: true }, confirmation: null,
};
const detail = {
  project: summary,
  main: { sessionId: "s", turnActive: false },
  roadmap: { revision: 1, nodes: [node], edges: [{ from: "n", to: "m" }] },
};

describe("F9.9a project contract", () => {
  it("names every method with an explicit version", () => {
    expect([projectListMethod, projectCreateMethod, projectGetMethod, projectMailboxMethod, projectResourcesMethod]
      .map(method => method.name)).toEqual([
      "project.list.v1", "project.create.v1", "project.get.v1", "project.mailbox.v1", "project.resources.v1",
    ]);
  });

  it("validates inputs strictly", () => {
    expect(projectListMethod.parseInput({})).toEqual({});
    expect(projectCreateMethod.parseInput({ name: "Paper", goal: "Survey", workspaceRoot: "D:/work" }))
      .toEqual({ name: "Paper", goal: "Survey", workspaceRoot: "D:/work" });
    expect(projectCreateMethod.parseInput({ name: "Paper", goal: null, workspaceRoot: "D:/work" }))
      .toEqual({ name: "Paper", goal: null, workspaceRoot: "D:/work" });
    expect(projectMailboxMethod.parseInput({ projectId: "p", afterSequence: null, limit: 1 }))
      .toEqual({ projectId: "p", afterSequence: null, limit: 1 });
    for (const [method, value] of [
      [projectListMethod, { extra: true }],
      [projectCreateMethod, { name: "Paper", goal: "Survey" }],
      [projectCreateMethod, { name: "  ", goal: "Survey", workspaceRoot: "D:/work" }],
      [projectCreateMethod, { name: "Paper", goal: " \t ", workspaceRoot: "D:/work" }],
      [projectCreateMethod, { name: "Paper", goal: "x".repeat(PROJECT_GOAL_MAX_CHARS + 1), workspaceRoot: "D:/work" }],
      [projectCreateMethod, { name: "Paper", goal: undefined, workspaceRoot: "D:/work" }],
      [projectCreateMethod, { name: "x".repeat(PROJECT_NAME_MAX_CHARS + 1), goal: "Survey", workspaceRoot: "D:/work" }],
      [projectGetMethod, { projectId: "" }],
      [projectMailboxMethod, { projectId: "p", limit: 1 }],
      [projectMailboxMethod, { projectId: "p", afterSequence: -1, limit: 1 }],
      [projectMailboxMethod, { projectId: "p", afterSequence: null, limit: PROJECT_MAILBOX_PAGE_MAX + 1 }],
    ] as const) {
      expect(() => method.parseInput(value)).toThrow(RpcError);
    }
  });

  it("accepts the documented outputs and rejects extra or inconsistent fields", () => {
    expect(projectGetMethod.parseOutput(detail)).toEqual(detail);
    expect(projectGetMethod.parseOutput({ ...detail, roadmap: null })).toEqual({ ...detail, roadmap: null });
    expect(projectListMethod.parseOutput({ projects: [{ ...summary, workspaceRoot: null }] }).projects[0]?.workspaceRoot)
      .toBeNull();
    expect(projectListMethod.parseOutput({ projects: [{ ...summary, goal: null }] }).projects[0]?.goal)
      .toBeNull();
    for (const candidate of [
      { ...detail, project: { ...summary, goal: "" } },
      { ...detail, extra: 1 },
      { ...detail, project: { ...summary, status: "deleted" } },
      { ...detail, roadmap: { ...detail.roadmap, nodes: [{ ...node, controlPurpose: "start" }] } },
      { ...detail, roadmap: { ...detail.roadmap, nodes: [{ ...node, status: "done" }] } },
      { ...detail, roadmap: { ...detail.roadmap, nodes: [{ ...node, actions: { run: true } }] } },
    ]) {
      expect(() => projectGetMethod.parseOutput(candidate)).toThrow(RpcError);
    }
    const message = {
      messageId: "m", sequence: 1, timestamp: summary.createdAt,
      sender: { kind: "node", nodeId: "n" }, recipient: { kind: "main" }, body: "hi",
    };
    expect(projectMailboxMethod.parseOutput({ messages: [message], nextSequence: null }).messages).toHaveLength(1);
    expect(() => projectMailboxMethod.parseOutput({ messages: [{ ...message, recipient: { kind: "node" } }], nextSequence: null }))
      .toThrow(RpcError);
    const resource = {
      resourceId: "r", owner: { kind: "main" }, name: "Report", description: "", type: "text/markdown",
      entryRef: "assets/r/report.md", access: { kind: "shared", nodeIds: ["n"] }, revision: 1,
      createdAt: summary.createdAt, updatedAt: summary.createdAt,
    };
    expect(projectResourcesMethod.parseOutput({ resources: [resource] }).resources[0]?.access)
      .toEqual({ kind: "shared", nodeIds: ["n"] });
    expect(() => projectResourcesMethod.parseOutput({ resources: [{ ...resource, access: { kind: "project" } }] }))
      .toThrow(RpcError);
  });

  it("requires exactly one result item", () => {
    const empty = projectListMethod.createOutputValidator!({});
    expect(() => empty.end()).toThrow(RpcError);
    const twice = projectListMethod.createOutputValidator!({});
    twice.parse({ projects: [] });
    expect(() => twice.parse({ projects: [] })).toThrow(RpcError);
  });

  it("forwards a handler's business failure through the error frame", async () => {
    const pair = createTransportPair();
    const router = new StreamRpcRouter();
    const failure = { code: "project-not-found", message: "Project was not found.", details: {} };
    router.register(projectGetMethod, async function* () {
      yield* [];
      throw new RpcError("remote-error", failure.message, { failure });
    });
    router.register(projectListMethod, async function* () {
      yield* [];
      throw new Error("private detail");
    });
    const server = new StreamRpcServer(pair.server, router);
    const serving = server.serve();
    const client = new StreamRpcClient(pair.client);
    const errorOf = async (stream: AsyncIterable<unknown>) => {
      try {
        for await (const _ of stream) void _;
      } catch (error: unknown) {
        return error as RpcError;
      }
      throw new Error("expected failure");
    };
    expect((await errorOf(client.stream(projectGetMethod, { projectId: "p" }))).failure).toEqual(failure);
    expect((await errorOf(client.stream(projectListMethod, {}))).failure)
      .toEqual({ code: "stream-failed", message: "RPC stream handler failed", details: {} });
    pair.close();
    await server.dispose();
    await serving;
  });
  it("validates Human turn and review inputs", () => {
    const turn = { projectId: "p", requestId: "r", text: "Go", target: { kind: "node", nodeId: "n" } };
    expect(projectTurnMethod.name).toBe("project.turn.v1");
    expect(projectNodeReviewMethod.name).toBe("project.node.review.v1");
    expect(projectTurnMethod.parseInput(turn)).toEqual(turn);
    expect(projectTurnMethod.parseInput({ ...turn, target: { kind: "main" } }).target).toEqual({ kind: "main" });
    for (const candidate of [
      { ...turn, target: { kind: "main", nodeId: "n" } },
      { ...turn, target: { kind: "node" } },
      { ...turn, text: " " },
      { ...turn, sessionId: "s" },
    ]) {
      expect(() => projectTurnMethod.parseInput(candidate)).toThrow(RpcError);
    }
    const review = { projectId: "p", nodeId: "n", action: "skip", reason: "Not needed", reviewedRevision: 2 };
    expect(projectNodeReviewMethod.parseInput(review)).toEqual(review);
    for (const candidate of [
      { ...review, action: "delete" }, { ...review, reason: "" }, { ...review, reviewedRevision: 0 },
      { ...review, confirmedBy: "someone" },
    ]) {
      expect(() => projectNodeReviewMethod.parseInput(candidate)).toThrow(RpcError);
    }
    expect(projectNodeReviewMethod.parseOutput(node)).toEqual(node);
  });

  it("adopts the Session announced by the first turn event and then enforces it", () => {
    const input = { projectId: "p", requestId: "r", text: "Go", target: { kind: "main" as const } };
    const started = { type: "turn-started", sessionId: "main-session", requestId: "r", turnId: "t" };
    const validator = projectTurnMethod.createOutputValidator!(input);
    expect(validator.parse(started)).toEqual(started);
    expect(() => validator.parse({ ...started, type: "turn-cancelled", sessionId: "other" })).toThrow(RpcError);
    expect(() => projectTurnMethod.createOutputValidator!(input).end()).toThrow(RpcError);
    expect(() => projectTurnMethod.createOutputValidator!(input).parse({ ...started, requestId: "x" })).toThrow(RpcError);
  });
  it("accepts repeated follow frames after a required baseline", () => {
    const frame = { detail, mailboxSequence: 0, resourceRevision: 0 };
    expect(projectFollowMethod.name).toBe("project.follow.v1");
    const validator = projectFollowMethod.createOutputValidator!({ projectId: "p" });
    expect(validator.parse(frame)).toEqual(frame);
    expect(validator.parse({ ...frame, mailboxSequence: 3 }).mailboxSequence).toBe(3);
    expect(() => validator.end()).not.toThrow();
    expect(() => projectFollowMethod.createOutputValidator!({ projectId: "p" }).end()).toThrow(RpcError);
    expect(() => projectFollowMethod.parseOutput({ ...frame, resourceRevision: -1 })).toThrow(RpcError);
    expect(() => projectFollowMethod.parseOutput({ detail })).toThrow(RpcError);
  });
});
