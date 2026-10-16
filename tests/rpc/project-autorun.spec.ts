import { describe, expect, it } from "vitest";

import {
  projectAutoRunGetMethod,
  projectAutoRunPauseMethod,
  projectAutoRunResumeMethod,
  projectAutoRunStartMethod,
} from "../../rpc/project.js";
import { RpcError } from "../../rpc/errors.js";

const snapshot = {
  runId: "run-1",
  projectId: "project-1",
  status: "paused",
  nodeTurns: 3,
  mainTurns: 1,
  currentTarget: { kind: "node", nodeId: "node-1" },
  reason: "human-paused",
} as const;

describe("F11.3 AutoRun RPC contract", () => {
  it("uses versioned method names and shared ProjectRef input", () => {
    expect(projectAutoRunStartMethod.name).toBe("project.autorun.start.v1");
    expect(projectAutoRunPauseMethod.name).toBe("project.autorun.pause.v1");
    expect(projectAutoRunResumeMethod.name).toBe("project.autorun.resume.v1");
    expect(projectAutoRunGetMethod.name).toBe("project.autorun.get.v1");

    expect(projectAutoRunStartMethod.parseInput({ projectId: "project-1" }))
      .toEqual({ projectId: "project-1" });
  });

  it("strictly validates AutoRun snapshots", () => {
    expect(projectAutoRunPauseMethod.parseOutput(snapshot)).toEqual(snapshot);
    expect(projectAutoRunGetMethod.parseOutput(null)).toBeNull();

    expect(() => projectAutoRunStartMethod.parseOutput({
      ...snapshot,
      unexpected: true,
    })).toThrow(RpcError);

    expect(() => projectAutoRunStartMethod.parseOutput({
      ...snapshot,
      currentTarget: { kind: "node" },
    })).toThrow(RpcError);
  });

  it("accepts a main target and null stop reason", () => {
    expect(projectAutoRunGetMethod.parseOutput({
      ...snapshot,
      status: "running",
      currentTarget: { kind: "main" },
      reason: null,
    })).toMatchObject({
      status: "running",
      currentTarget: { kind: "main" },
      reason: null,
    });
  });
});
