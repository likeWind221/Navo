import { expect, it } from "vitest";
import { projectAutoRunFollowMethod } from "../../rpc/project/autorun.js";

const snapshot = { runId: "run", projectId: "project", status: "running" as const,
  nodeTurns: 0, mainTurns: 0, currentTarget: null, reason: null };

it("requires a baseline and validates run, target and late-turn identity", () => {
  const input = projectAutoRunFollowMethod.parseInput({ projectId: "project" });
  const validator = projectAutoRunFollowMethod.createOutputValidator!(input);
  const baseline = { type: "snapshot" as const, snapshot: null };
  validator.parse(baseline);
  validator.parse({ type: "run-started", snapshot });
  validator.parse({ type: "target-started", runId: "run", target: { kind: "node", nodeId: "node" } });
  validator.parse({ type: "turn-baseline", runId: "run", target: { kind: "node", nodeId: "node" },
    sessionId: "session", turnId: "turn" });
  validator.parse({ type: "turn-event", runId: "run", target: { kind: "node", nodeId: "node" }, event: {
    type: "content-delta", sessionId: "session", requestId: "request", turnId: "turn", stepId: "step",
    messageId: "message", contentIndex: 0, delta: "partial",
  } });
  validator.parse({ type: "turn-event", runId: "run", target: { kind: "node", nodeId: "node" }, event: {
    type: "turn-cancelled", sessionId: "session", requestId: "request", turnId: "turn",
  } });
  validator.end();
  const invalidOrder = projectAutoRunFollowMethod.createOutputValidator!(input);
  expect(() => invalidOrder.parse({ type: "target-started", runId: "run", target: { kind: "main" } })).toThrow();
});

it("rejects crossed run or target identities", () => {
  const input = projectAutoRunFollowMethod.parseInput({ projectId: "project" });
  const validator = projectAutoRunFollowMethod.createOutputValidator!(input);
  validator.parse({ type: "snapshot", snapshot });
  expect(() => validator.parse({ type: "pause-requested", runId: "other" })).toThrow();
  expect(() => projectAutoRunFollowMethod.parseOutput({ type: "snapshot", snapshot, extra: true })).toThrow();
  const wrongProject = projectAutoRunFollowMethod.createOutputValidator!(input);
  expect(() => wrongProject.parse({ type: "snapshot", snapshot: { ...snapshot, projectId: "other" } })).toThrow();
  const duplicate = projectAutoRunFollowMethod.createOutputValidator!(input);
  duplicate.parse({ type: "snapshot", snapshot: null });
  duplicate.parse({ type: "run-started", snapshot });
  expect(() => duplicate.parse({ type: "run-started", snapshot: { ...snapshot, runId: "run-2" } })).toThrow();
  const transitions = projectAutoRunFollowMethod.createOutputValidator!(input);
  transitions.parse({ type: "snapshot", snapshot: null });
  transitions.parse({ type: "run-started", snapshot });
  expect(() => transitions.parse({ type: "snapshot", snapshot: { ...snapshot, currentTarget: { kind: "node", nodeId: "node" } } })).toThrow();
  transitions.parse({ type: "target-started", runId: "run", target: { kind: "node", nodeId: "node" } });
  transitions.parse({ type: "turn-event", runId: "run", target: { kind: "node", nodeId: "node" }, event: {
    type: "turn-started", sessionId: "session", requestId: "request", turnId: "turn",
  } });
  expect(() => transitions.parse({ type: "snapshot", snapshot: { ...snapshot, status: "paused", currentTarget: { kind: "node", nodeId: "node" } } })).toThrow();
  const paused = projectAutoRunFollowMethod.createOutputValidator!(input);
  paused.parse({ type: "snapshot", snapshot: { ...snapshot, status: "paused" } });
  expect(() => paused.parse({ type: "target-started", runId: "run", target: { kind: "main" } })).toThrow();
});
