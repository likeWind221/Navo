import { describe, expect, it } from "vitest";

import { RpcError, projectSessionRecoveryMethod } from "../../rpc/index.js";

describe("project.session.recovery.v1", () => {
  it("requires an exact project reference and parses all recovery states", () => {
    expect(projectSessionRecoveryMethod.parseInput({ projectId: "project-1" })).toEqual({ projectId: "project-1" });
    expect(() => projectSessionRecoveryMethod.parseInput({ projectId: "project-1", extra: true })).toThrow(RpcError);
    const output = {
      projectId: "project-1",
      sessions: [
        { owner: { kind: "main" }, status: "available", sessionId: "main-1", lastEndedTurn: null },
        { owner: { kind: "node", nodeId: "node-1" }, status: "unestablished" },
        { owner: { kind: "node", nodeId: "node-2" }, status: "unavailable", sessionId: "node-session-2", reason: "not-readable" },
      ],
    } as const;
    expect(projectSessionRecoveryMethod.parseOutput(output)).toEqual(output);
  });

  it("rejects an untrusted turn timestamp or interruption value", () => {
    const output = {
      projectId: "project-1",
      sessions: [{
        owner: { kind: "main" },
        status: "available",
        sessionId: "main-1",
        lastEndedTurn: {
          turnId: "turn-1", status: "failed", startedAt: "bad", endedAt: new Date().toISOString(), interruption: "host-stopped",
        },
      }],
    };
    expect(() => projectSessionRecoveryMethod.parseOutput(output)).toThrow(RpcError);
    const firstSession = output.sessions[0]!;
    expect(() => projectSessionRecoveryMethod.parseOutput({
      ...output,
      sessions: [{ ...firstSession, lastEndedTurn: {
        ...firstSession.lastEndedTurn, startedAt: new Date().toISOString(), interruption: "other",
      } }],
    })).toThrow(RpcError);
  });
});
