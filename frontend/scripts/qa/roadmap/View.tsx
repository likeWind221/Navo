import { createRoot } from "react-dom/client";
import type { DesktopProjectApi, DesktopProjectEvent } from "../../../shared/project.js";
import type { NodeV1, ProjectDetailV1 } from "../../../../rpc/project.js";
import { ProjectWorkspace } from "../../../src/workspace/project/Workspace";
import "../../../src/styles.css";

const nodes: NodeV1[] = ["completing", "working", "idle", "submitted", "locked", "skipped"].map((status, index) => ({
  nodeId: String(index + 1), revision: 1, title: ["明确研究问题", "整理文献证据", "复现基线方法", "提出改进方案", "对比与综合结论", "补充案例分析"][index]!,
  description: "围绕长程 Agent 的规划、执行和验证，形成可检查的研究结果。", acceptanceCriteria: ["保存原始证据", "明确未验证边界"],
  requirement: index === 5 ? "optional" : "required", status: status as NodeV1["status"], hasSession: false, turnActive: status === "working",
  actions: { run: false, complete: status === "submitted", skip: false, rework: status === "submitted", review: status === "submitted" },
  confirmation: null, submission: null, pendingFeedback: null, review: null, reworkCount: 0, reviewPending: false,
}));
let detail: ProjectDetailV1 = {
  project: { projectId: "roadmap-qa", name: "长程 Agent 可靠性研究", goal: "探索长程任务中的规划、执行与验证机制", workspaceRoot: "D:/Research/Agent", status: "active", revision: 1, createdAt: new Date().toISOString() },
  main: { sessionId: "main-qa", turnActive: false },
  roadmap: { revision: 1, nodes, edges: [{ from: "1", to: "2" }, { from: "1", to: "3" }, { from: "1", to: "4" }, { from: "2", to: "5" }, { from: "3", to: "5" }, { from: "4", to: "5" }] },
};
const listeners = new Set<(event: DesktopProjectEvent) => void>();
let follows = 0;
let turns = 0;
function emit(event: DesktopProjectEvent): void { for (const listener of listeners) listener(event); }
function publish(): void { emit({ type: "follow-snapshot", projectId: detail.project.projectId, operationId: "follow-" + follows, snapshot: { mailboxSequence: 0, resourceRevision: 0, detail } }); }
const unsupported = async (): Promise<never> => { throw new Error("Unexpected QA API call"); };
const api: DesktopProjectApi = {
  list: unsupported, create: unsupported, get: unsupported, review: unsupported, autoRunStart: unsupported, autoRunPause: unsupported, autoRunResume: unsupported, autoRunGet: unsupported, chooseWorkspace: unsupported,
  async getSessions() { return { type: "ok", value: { projectId: detail.project.projectId, sessions: nodes.map(node => ({ owner: { kind: "node" as const, nodeId: node.nodeId }, status: "unestablished" as const })) } }; },
  onEvent(listener: (event: DesktopProjectEvent) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  async startFollow() { follows += 1; queueMicrotask(publish); return { type: "ok", value: { subscriptionId: "follow-" + follows } }; },
  async cancel() { return { type: "ok", value: null }; },
  async startTurn() { turns += 1; return { type: "failed", failure: { code: "invalid-state", message: "QA does not run agents" } }; },
};

function mutate(kind: string): void {
  const roadmap = detail.roadmap!;
  const next = kind === "clear" ? { ...roadmap, nodes: [], edges: [] }
    : kind === "restore" ? { ...roadmap, nodes, edges: [{ from: "1", to: "2" }] }
    : kind === "remove" ? { ...roadmap, nodes: roadmap.nodes.filter(node => node.nodeId !== "5"), edges: roadmap.edges.filter(edge => edge.from !== "5" && edge.to !== "5") }
    : { ...roadmap, nodes: [...roadmap.nodes.map(node => node.nodeId === "2" ? { ...node, title: "文献已提交", status: "submitted" as const } : node), { ...nodes[4]!, nodeId: "7", title: "补充验证", status: "idle" as const }], edges: [{ from: "1", to: "2" }, { from: "2", to: "5" }, { from: "3", to: "5" }, { from: "5", to: "7" }] };
  detail = { ...detail, roadmap: { ...next, revision: roadmap.revision + 1 } };
  publish();
}

createRoot(document.getElementById("root")!).render(<div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
  <nav style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 8 }} aria-label="验收控制"><button onClick={() => mutate("update")}>更新快照</button><button onClick={() => mutate("remove")}>移除汇合节点</button><button onClick={() => mutate("clear")}>清空路线</button><button onClick={() => mutate("restore")}>恢复路线</button><button onClick={() => emit({ type: "follow-error", projectId: detail.project.projectId, operationId: "follow-" + follows, failure: { code: "host-unavailable", message: "观察连接断开" } })}>中断观察</button><output id="turn-count" onClick={event => { event.currentTarget.textContent = String(turns); }}>0</output></nav>
  <div style={{ flex: 1, minHeight: 0 }}><ProjectWorkspace detail={detail} api={api} /></div>
</div>);
