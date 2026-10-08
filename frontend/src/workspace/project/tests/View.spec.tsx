import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProjectCreate } from "../Create.js";
import { ProjectDetailView } from "../Detail.js";
import { ProjectNotice } from "../Notice.js";

const project = {
  projectId: "project-1",
  name: "调研",
  goal: "整理资料",
  workspaceRoot: null,
  status: "active" as const,
  revision: 1,
  createdAt: "2026-10-08T00:00:00.000Z",
};

describe("ProjectDetailView", () => {
  it("shows the project facts and a pending workspace binding", () => {
    const markup = renderToStaticMarkup(<ProjectDetailView onRetry={vi.fn()} state={{
      status: "ready",
      detail: { project, main: { sessionId: "s-1", turnActive: false }, roadmap: null },
    }} />);

    expect(markup).toContain("调研");
    expect(markup).toContain("整理资料");
    expect(markup).toContain("绑定中");
    expect(markup).toContain("进行中");
    expect(markup).toContain("dateTime=\"2026-10-08T00:00:00.000Z\"");
  });

  it("shows a pending goal when the goal is not confirmed", () => {
    const markup = renderToStaticMarkup(<ProjectDetailView onRetry={vi.fn()} state={{
      status: "ready",
      detail: { project: { ...project, goal: null }, main: { sessionId: "s-1", turnActive: false }, roadmap: null },
    }} />);

    expect(markup).toContain("目标待确定");
  });

  it("shows a readable failure with retry", () => {
    const markup = renderToStaticMarkup(<ProjectDetailView onRetry={vi.fn()} state={{
      status: "failed", failure: { code: "project-not-found", message: "missing" },
    }} />);

    expect(markup).toContain("Host 重启已被清空");
    expect(markup).toContain("重试");
  });
});

describe("ProjectNotice", () => {
  it("explains the empty in-memory list and hides itself once projects exist", () => {
    expect(renderToStaticMarkup(<ProjectNotice onRetry={vi.fn()} state={{ status: "ready", projects: [], failure: null }} />))
      .toContain("Host 重启后会清空");
    expect(renderToStaticMarkup(<ProjectNotice onRetry={vi.fn()} state={{ status: "ready", projects: [project], failure: null }} />))
      .toBe("");
    expect(renderToStaticMarkup(<ProjectNotice onRetry={vi.fn()} state={{
      status: "failed", projects: [project], failure: { code: "host-unavailable", message: "down" },
    }} />)).toContain("后端未连接");
  });
});

describe("ProjectCreate", () => {
  it("renders the required fields with contract limits", () => {
    const markup = renderToStaticMarkup(<ProjectCreate api={undefined} create={vi.fn()} onCreated={vi.fn()} onClose={vi.fn()} />);

    expect(markup).toContain("新建项目");
    expect(markup).toContain("maxLength=\"80\"");
    expect(markup).toContain("maxLength=\"8000\"");
    expect(markup).toContain("项目目标（可选）");
    expect(markup).toContain("可留空，之后在对话中与 Main 确认");
    expect(markup).toContain("尚未选择");
    expect(markup).toContain("创建项目");
  });
});
