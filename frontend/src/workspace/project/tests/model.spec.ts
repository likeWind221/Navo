import { describe, expect, it } from "vitest";

import type { ProjectSummaryV1 } from "../../../../../rpc/project.js";
import type { DesktopProjectFailureCode } from "../../../../shared/project.js";
import { checkDraft } from "../draft.js";
import { projectFailureMessage } from "../failure.js";
import { initialProjectListState, projectListReducer } from "../hook.js";

const project: ProjectSummaryV1 = {
  projectId: "project-1",
  name: "调研",
  goal: "整理资料",
  workspaceRoot: "D:\\work",
  status: "active",
  revision: 1,
  createdAt: "2026-10-08T00:00:00.000Z",
};

describe("checkDraft", () => {
  it("requires a name and a chosen workspace but lets the goal stay empty", () => {
    expect(checkDraft({ name: " ", goal: "g", workspaceRoot: "D:\\w" })).toEqual({ type: "problem", message: "请填写项目名称。" });
    expect(checkDraft({ name: "n", goal: "  ", workspaceRoot: "D:\\w" })).toEqual({
      type: "ready", input: { name: "n", goal: null, workspaceRoot: "D:\\w" },
    });
    expect(checkDraft({ name: "n", goal: "", workspaceRoot: "D:\\w" })).toMatchObject({ type: "ready", input: { goal: null } });
    expect(checkDraft({ name: "n", goal: "g", workspaceRoot: null })).toEqual({ type: "problem", message: "请选择工作目录。" });
  });

  it("enforces contract limits and trims only the name", () => {
    expect(checkDraft({ name: "n".repeat(81), goal: "g", workspaceRoot: "D:\\w" }).type).toBe("problem");
    expect(checkDraft({ name: "n", goal: "g".repeat(8_001), workspaceRoot: "D:\\w" }).type).toBe("problem");
    expect(checkDraft({ name: "n", goal: "g", workspaceRoot: "w".repeat(4_097) }).type).toBe("problem");
    expect(checkDraft({ name: "  调研 ", goal: " 目标 ", workspaceRoot: "D:\\w" })).toEqual({
      type: "ready", input: { name: "调研", goal: " 目标 ", workspaceRoot: "D:\\w" },
    });
  });
});

describe("projectFailureMessage", () => {
  it("covers every desktop project failure code", () => {
    const codes: DesktopProjectFailureCode[] = [
      "invalid-request", "project-not-found", "node-not-found", "project-unavailable", "turn-active",
      "invalid-state", "revision-conflict", "workspace-conflict", "workspace-invalid", "runtime-unavailable",
      "internal", "host-unavailable", "invalid-input", "invalid-output", "bridge-closed",
    ];
    const messages = codes.map(code => projectFailureMessage({ code, message: "raw detail" }));
    expect(messages.every(message => message.length > 0)).toBe(true);
    expect(projectFailureMessage({ code: "workspace-conflict", message: "x" })).toContain("已被其他项目绑定");
    expect(projectFailureMessage({ code: "revision-conflict", message: "raw detail" })).toContain("raw detail");
  });
});

describe("projectListReducer", () => {
  it("keeps the last list on failure and upserts created projects", () => {
    const loaded = projectListReducer(initialProjectListState, { type: "loaded", projects: [project] });
    expect(loaded).toEqual({ status: "ready", projects: [project], failure: null });

    const failed = projectListReducer(loaded, { type: "failed", failure: { code: "host-unavailable", message: "down" } });
    expect(failed.projects).toEqual([project]);
    expect(failed.status).toBe("failed");

    const created = projectListReducer(loaded, { type: "created", project: { ...project, projectId: "project-2" } });
    expect(created.projects.map(item => item.projectId)).toEqual(["project-1", "project-2"]);
    const replaced = projectListReducer(created, { type: "created", project: { ...project, name: "新名称" } });
    expect(replaced.projects.map(item => item.name)).toEqual(["新名称", "调研"]);
  });
});
