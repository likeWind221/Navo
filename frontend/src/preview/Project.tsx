import { WorkspaceShell } from "../workspace/Shell";
import { ProjectWorkspace } from "../workspace/project/Workspace";
import type { WorkspaceNode } from "../workspace/project/Workspace";
import type { ProjectDetailV1 } from "../../../rpc/project.js";

const nodes: readonly WorkspaceNode[] = [
  { id: "scope", title: "明确研究问题", note: "确定目标、范围与验收条件", status: "已完成", x: 70, y: 180 },
  { id: "papers", title: "检索与整理文献", note: "建立关键论文与证据清单", status: "进行中", x: 360, y: 100 },
  { id: "baseline", title: "复现基线方法", note: "准备环境与最小可运行实验", status: "可执行", x: 360, y: 330 },
  { id: "compare", title: "对比与验证", note: "汇合证据，检查研究结论", status: "待解锁", x: 660, y: 210 },
  { id: "report", title: "形成研究报告", note: "整理结论与可追溯的产物", status: "待解锁", x: 960, y: 210 },
];

const detail: ProjectDetailV1 = {
  project: {
    projectId: "research", name: "长程 Agent 可靠性研究", goal: "探索长程任务中的规划、执行与验证机制",
    workspaceRoot: "D:/Research/Agent", status: "active", revision: 1, createdAt: "2026-10-13T00:00:00.000Z",
  },
  main: { sessionId: "preview-main", turnActive: false },
  roadmap: null,
};

export default function ProjectPreview(): React.JSX.Element {
  return <WorkspaceShell initialSection="project" openRequest={{ id: "research" }} entries={[
    { id: "research", kind: "project", title: detail.project.name, content: <ProjectWorkspace detail={detail} demo={nodes} /> },
  ]} />;
}
