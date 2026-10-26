import { useRef, useState } from "react";
import { WorkspaceShell } from "../workspace/Shell";
import { ProjectWorkspace } from "../workspace/project/Workspace";
import type { MapGraph } from "../workspace/project/map/model";
import type { ProjectDetailV1 } from "../../../rpc/project.js";

const initial: MapGraph = {
  nodes: [
    { id: "scope", title: "明确研究问题", note: "确定目标、范围与验收条件", status: "已完成" },
    { id: "papers", title: "检索与整理文献", note: "建立关键论文与证据清单", status: "进行中" },
    { id: "baseline", title: "复现基线方法", note: "准备环境与最小可运行实验", status: "可执行" },
    { id: "compare", title: "对比与验证", note: "汇合证据，检查研究结论", status: "待解锁" },
    { id: "report", title: "形成研究报告", note: "整理结论与可追溯的产物", status: "待解锁" },
  ],
  edges: [
    { from: "scope", to: "papers" }, { from: "scope", to: "baseline" },
    { from: "papers", to: "compare" }, { from: "baseline", to: "compare" }, { from: "compare", to: "report" },
  ],
};

const detail: ProjectDetailV1 = {
  project: {
    projectId: "research", name: "长程 Agent 可靠性研究", goal: "探索长程任务中的规划、执行与验证机制",
    workspaceRoot: "D:/Research/Agent", status: "active", revision: 1, createdAt: "2026-10-13T00:00:00.000Z",
  },
  main: { sessionId: "preview-main", turnActive: false },
  roadmap: null,
};

export default function ProjectPreview(): React.JSX.Element {
  const [graph, setGraph] = useState(initial);
  const sequence = useRef(1);

  function add(): void {
    const number = sequence.current++;
    const id = `explore-${number}`;
    setGraph(previous => ({
      nodes: [...previous.nodes, { id, title: `新的探索 ${number}`, note: "路线新增后生成的独立浮空岛", status: "待解锁" }],
      edges: previous.nodes.length === 0 ? [] : [...previous.edges, { from: previous.nodes.at(-1)!.id, to: id }],
    }));
  }

  function remove(): void {
    setGraph(previous => {
      const id = previous.nodes.at(-1)?.id;
      return { nodes: previous.nodes.slice(0, -1), edges: previous.edges.filter(edge => edge.from !== id && edge.to !== id) };
    });
  }

  return <WorkspaceShell initialSection="project" openRequest={{ id: "research" }} entries={[
    { id: "research", kind: "project", title: detail.project.name, content: <ProjectWorkspace detail={detail} demo={graph}
      previewControls={<><span>生成预览</span><button onClick={add}>新增岛屿</button><button disabled={graph.nodes.length === 0} onClick={remove}>移除末岛</button></>} /> },
  ]} />;
}
