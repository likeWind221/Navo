import { describe, expect, it } from "vitest";

import { parseProjectSummary } from "../../../../rpc/project/validation.js";
import { parseDesktopProjectResult, parseWorkspaceChoice } from "../validation.js";

const summary = {
  projectId: "project-1",
  name: "调研",
  goal: "整理资料",
  workspaceRoot: "D:\\work",
  status: "active",
  revision: 1,
  createdAt: "2026-10-08T00:00:00.000Z",
};

describe("parseDesktopProjectResult", () => {
  it("parses success values with the contract parser", () => {
    expect(parseDesktopProjectResult({ type: "ok", value: summary }, parseProjectSummary))
      .toEqual({ type: "ok", value: summary });
    expect(() => parseDesktopProjectResult({ type: "ok", value: { ...summary, extra: 1 } }, parseProjectSummary))
      .toThrow();
  });

  it("accepts project and bridge failure codes only", () => {
    expect(parseDesktopProjectResult(
      { type: "failed", failure: { code: "workspace-conflict", message: "bound" } }, parseProjectSummary,
    )).toEqual({ type: "failed", failure: { code: "workspace-conflict", message: "bound" } });
    expect(parseDesktopProjectResult(
      { type: "failed", failure: { code: "host-unavailable", message: "down" } }, parseProjectSummary,
    ).type).toBe("failed");
    expect(() => parseDesktopProjectResult(
      { type: "failed", failure: { code: "stream-failed", message: "x" } }, parseProjectSummary,
    )).toThrow();
    expect(() => parseDesktopProjectResult({ type: "failed" }, parseProjectSummary)).toThrow();
  });
});

describe("parseWorkspaceChoice", () => {
  it("accepts null or a visible bounded path", () => {
    expect(parseWorkspaceChoice(null)).toBeNull();
    expect(parseWorkspaceChoice("D:\\work")).toBe("D:\\work");
    expect(() => parseWorkspaceChoice("   ")).toThrow();
    expect(() => parseWorkspaceChoice("x".repeat(4_097))).toThrow();
    expect(() => parseWorkspaceChoice(1)).toThrow();
  });
});
