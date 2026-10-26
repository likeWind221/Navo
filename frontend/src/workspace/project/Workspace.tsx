import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { NodeStatusV1, ProjectDetailV1 } from "../../../../rpc/project.js";
import { Icon } from "../../ui/Icon";
import { RoadmapMap } from "./Map";
import type { MapGraph } from "./map/model";
import styles from "./workspace.module.css";

type Message = { role: "user" | "assistant"; text: string };
const statusLabels: Record<NodeStatusV1, string> = { locked: "待解锁", idle: "可执行", working: "进行中", submitted: "待验收", completing: "已完成", skipped: "已跳过" };

export function ProjectWorkspace({ detail, demo, previewControls }: { readonly detail: ProjectDetailV1; readonly demo?: MapGraph; readonly previewControls?: ReactNode }): React.JSX.Element {
  const graph = useMemo<MapGraph>(() => demo ?? {
    nodes: detail.roadmap?.nodes.map(node => ({ id: node.nodeId, title: node.title, note: node.description, status: statusLabels[node.status] })) ?? [],
    edges: detail.roadmap?.edges ?? [],
  }, [demo, detail.roadmap]);
  const nodes = graph.nodes;
  const project = detail.project;
  const [showDemo, setShowDemo] = useState(Boolean(demo));
  const planned = nodes.length > 0 && (demo ? showDemo : true);
  const [active, setActive] = useState("main");
  const [opened, setOpened] = useState<string[]>([]);
  const [visible, setVisible] = useState(true);
  const [full, setFull] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const node = nodes.find(item => item.id === active);
  const title = node?.title ?? "Main";
  const nodeNumber = String(nodes.findIndex(item => item.id === active) + 1).padStart(2, "0");

  useEffect(() => {
    const ids = new Set(nodes.map(item => item.id));
    setOpened(previous => previous.filter(id => ids.has(id)));
    setActive(previous => previous === "main" || ids.has(previous) ? previous : "main");
  }, [nodes]);

  function openNode(id: string): void {
    setOpened(previous => previous.includes(id) ? previous : [...previous, id]);
    setActive(id);
    setVisible(true);
  }

  function closeNode(id: string): void {
    setOpened(previous => previous.filter(value => value !== id));
    if (active === id) setActive("main");
  }

  function send(): void {
    const value = drafts[active]?.trim();
    if (!value) return;
    setMessages(previous => ({ ...previous, [active]: [...(previous[active] ?? []),
      { role: "user", text: value },
      { role: "assistant", text: active === "main" ? "我会围绕研究目标继续调整路线。你可以点击中间的节点，查看该任务的工作会话。" : "已记录这条要求。这里将承载该节点的执行对话、工具过程与结果。" },
    ] }));
    setDrafts(previous => ({ ...previous, [active]: "" }));
  }

  return <article className={styles.project} data-panel={visible} data-full={full} aria-label={`项目 ${project.name}`}>
    <header className={styles.mapHeader}>
      <div className={styles.eyebrow}>RESEARCH WORKSPACE</div>
      <h1>{project.name}</h1>
      <p>{project.goal ?? "目标待确定"}</p>
      <div className={styles.mapTools}><span><Icon name="map" />Roadmap <small>执行路线</small></span>
        <span>{planned ? `${nodes.length} 座岛屿 · ${nodes.filter(item => item.status === "已完成").length} 个已完成` : detail.roadmap === null ? "尚未规划" : "路线已创建"}</span></div>
      {previewControls && <div className={styles.previewTools}>{previewControls}</div>}
    </header>
    <RoadmapMap graph={graph} active={active} planned={planned} onOpen={openNode}>
      <div className={styles.empty}>
        <span className={styles.emptyIcon}><Icon name="guide" /></span>
        <span className={styles.eyebrow}>YOUR NEXT EXPLORATION</span>
        <h2>{demo && nodes.length === 0 ? "还没有节点岛屿" : detail.roadmap === null ? "从一个目标，走向一条路线" : "项目路线已创建"}</h2>
        <p>{demo && nodes.length === 0 ? "点击上方「新增岛屿」，看看路线如何生长。" : detail.roadmap === null ? "规划完成后，你的任务、依赖与进度会在这里展开。" : "路线地图展示即将开放，已有路线数据会继续保留。"}</p>
        {demo && nodes.length > 0 && <button onClick={() => setShowDemo(true)}>查看示例路线 <Icon name="arrow" /></button>}
      </div>
    </RoadmapMap>
    <footer className={styles.mapFoot}>
      <span><i />{demo ? "示例数据" : project.status === "active" ? "进行中" : "已归档"}</span>
      {demo && <button onClick={() => setShowDemo(value => !value)}>{planned ? "查看规划前空态" : "显示示例路线"}</button>}
      <span className={styles.dragHint}>左键旋转 · 滚轮缩放 · 右键平移</span>
    </footer>
    {!visible && <button className={styles.restore} aria-label="展开会话面板" onClick={() => setVisible(true)}><Icon name="chat" /><span>{title}</span><Icon name="chevron" /></button>}
    {visible && <aside className={styles.panel} data-full={full} aria-label="项目会话面板">
      <nav className={styles.rail} aria-label="项目内会话">
        <button className={styles.mainButton} aria-label="切换到 Main" aria-pressed={active === "main"} onClick={() => setActive("main")}>Main</button>
        {opened.map(id => <div key={id} className={styles.railNode} data-active={active === id}>
          <button title={nodes.find(item => item.id === id)?.title} aria-label={`切换到 ${nodes.find(item => item.id === id)?.title}`} onClick={() => setActive(id)}>Node {String(nodes.findIndex(item => item.id === id) + 1).padStart(2, "0")}</button>
          <button className={styles.closeNode} aria-label={`关闭 ${nodes.find(item => item.id === id)?.title}`} onClick={() => closeNode(id)}><Icon name="close" /></button>
        </div>)}
      </nav>
      <div className={styles.conversation}>
        <header className={styles.panelHeader}>
          <div className={styles.breadcrumb}>Main <span>/</span> {node ? `Node ${nodeNumber}` : "项目会话"}</div>
          <div className={styles.actions}>
            <button aria-label={full ? "恢复普通宽度" : "完全展开会话面板"} title={full ? "恢复普通宽度" : "完全展开"} onClick={() => setFull(value => !value)}><Icon name={full ? "minimize" : "maximize"} /></button>
            <button aria-label="收起会话面板" title="收起会话面板" onClick={() => setVisible(false)}><Icon name="chevron" /></button>
          </div>
        </header>
        <nav className={styles.auxiliary} aria-label="项目辅助信息">
          <details><summary>项目信息</summary><dl>
            <dt>工作目录</dt><dd><code>{project.workspaceRoot ?? "绑定中"}</code></dd>
            <dt>状态</dt><dd>{project.status === "active" ? "进行中" : "已归档"}</dd>
            <dt>创建时间</dt><dd><time dateTime={project.createdAt}>{new Date(project.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></dd>
          </dl></details>
          <button disabled title="消息查看即将开放">消息</button><button disabled title="资源查看即将开放">资源</button>
        </nav>
        <div className={styles.messages}>
          <div className={styles.nodeHeading}><span className={styles.nodeBadge} data-node={Boolean(node)}>{node ? nodeNumber : <Icon name="guide" />}</span><div><small>{node ? "NODE WORKSPACE" : "MAIN AGENT"}</small><h2>{node ? title : "一起探索下一步"}</h2></div></div>
          <div className={styles.context}><span>{node ? "当前节点" : "项目目标"}</span><p>{node?.note ?? project.goal ?? "目标待确定"}</p>{node && demo && <small>验收条件：提供可检查的结果与来源证据。</small>}</div>
          {demo ? <div className={styles.assistant}><div className={styles.author}><span>N</span><strong>{node ? "Node" : "Main"}</strong><small>工作会话</small></div><div>
            <p>{node ? `我们将围绕「${node.title}」展开工作。你可以补充要求，或明确发起这一步的执行。` : "我们先确认这项研究的目标与边界，再把它拆成可以逐步执行和验证的路线。"}</p>
            <p>{node ? "切回 Main 可以讨论整体路线。关闭这个会话入口后，草稿与内容仍会保留。" : "规划完成后，点击路线上的任意节点，就能在这里切换到它的工作会话。"}</p>
          </div></div> : <div className={styles.assistant}><p>项目对话即将开放。你可以先在下方准备草稿，切换项目后草稿仍会保留。</p>{detail.main.turnActive && <p>后端 Main 回合正在运行，对话过程展示尚未接入。</p>}</div>}
          {(messages[active] ?? []).map((message, index) => <div key={index} className={message.role === "user" ? styles.user : styles.reply}>{message.text}</div>)}
          {demo && nodes.length > 0 && !node && !planned && <button className={styles.planButton} onClick={() => setShowDemo(true)}>生成示例路线 <Icon name="arrow" /></button>}
          {node && <div className={styles.nodeHint}>{demo ? "原型仅展示交互，不启动 Agent 或修改节点状态。" : "节点工作会话尚未接入，当前只展示路线与保留草稿。"}</div>}
        </div>
        <div className={styles.composer}>
          <textarea aria-label={`${title} 草稿`} placeholder={node ? "补充这个节点的要求…" : "与 Main 讨论目标与路线…"} value={drafts[active] ?? ""} onChange={event => setDrafts(previous => ({ ...previous, [active]: event.target.value }))} />
          <div><span>{demo ? "原型演示 · 不调用模型" : "草稿 · 对话发送即将开放"}</span><button aria-label={demo ? "发送示例消息" : "发送消息"} disabled={!demo || !drafts[active]?.trim()} onClick={send}><Icon name="arrow" /></button></div>
        </div>
      </div>
    </aside>}
  </article>;
}
