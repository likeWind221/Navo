import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { ProjectDetailV1 } from "../../../../rpc/project.js";
import styles from "./workspace.module.css";

export interface WorkspaceNode {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly status: string;
  readonly x: number;
  readonly y: number;
}

type Message = { role: "user" | "assistant"; text: string };

export function ProjectWorkspace({ detail, demo }: { readonly detail: ProjectDetailV1; readonly demo?: readonly WorkspaceNode[] }): React.JSX.Element {
  const nodes = demo ?? [];
  const project = detail.project;
  const [planned, setPlanned] = useState(false);
  const [active, setActive] = useState("main");
  const [opened, setOpened] = useState<string[]>([]);
  const [visible, setVisible] = useState(true);
  const [full, setFull] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; origin: typeof position } | null>(null);
  const moved = useRef(false);
  const node = nodes.find(item => item.id === active);
  const title = node?.title ?? "Main";

  function startDrag(event: PointerEvent<HTMLDivElement>): void {
    if (!planned || event.button !== 0) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: position };
    moved.current = false;
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>): void {
    const start = gesture.current;
    if (start === null || event.pointerId !== start.id) return;
    const x = event.clientX - start.x;
    const y = event.clientY - start.y;
    if (!moved.current && Math.hypot(x, y) < 5) return;
    if (!moved.current) {
      event.currentTarget.setPointerCapture(event.pointerId);
      moved.current = true;
      setDragging(true);
    }
    setPosition({ x: start.origin.x + x, y: start.origin.y + y });
  }

  function endDrag(): void {
    gesture.current = null;
    setDragging(false);
  }

  function resetView(): void {
    const area = viewport.current!.getBoundingClientRect();
    const covered = visible && !full ? Math.max(0, area.right - panel.current!.getBoundingClientRect().left) : 0;
    const current = nodes.find(item => item.status === "进行中")!;
    setPosition({ x: (area.width - covered) / 2 - current.x - 110, y: area.height / 2 - current.y - 76 });
  }

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

  return <article className={styles.project} aria-label={`项目 ${project.name}`}>
    <div className={styles.mapHeader}>
      <div><div className={styles.eyebrow}>PROJECT</div><h1>{project.name}</h1><p>{project.goal ?? "目标待确定"}</p></div>
    </div>
    <div className={styles.mapTools}><span>Roadmap <small>执行路线</small></span><span>{planned ? "5 个节点 · 1 个已完成" : detail.roadmap === null ? "尚未规划" : "路线已创建"}</span></div>
    <div ref={viewport} className={styles.mapScroll} data-testid="roadmap" data-dragging={dragging} data-planned={planned}
      style={{ backgroundPosition: `${position.x}px ${position.y}px` }}
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onClickCapture={event => { if (moved.current) { event.preventDefault(); event.stopPropagation(); moved.current = false; } }}>
      {planned ? <div className={styles.map} style={{ transform: `translate(${position.x}px, ${position.y}px)` }}>
        <svg className={styles.edges} width="1260" height="650" aria-hidden="true">
          <path d="M 290 235 C 325 235 325 155 360 155 M 290 235 C 325 235 325 385 360 385 M 580 155 C 620 155 620 265 660 265 M 580 385 C 620 385 620 265 660 265 M 880 265 L 960 265" />
        </svg>
        {nodes.map((item, index) => <button key={item.id} data-testid={`node-${item.id}`} className={styles.node} data-selected={active === item.id} data-status={item.status} style={{ left: item.x, top: item.y }} onClick={() => openNode(item.id)}>
          <div className={styles.nodeTop}><span>0{index + 1}</span><span>{item.status}</span></div><strong>{item.title}</strong><p>{item.note}</p><div className={styles.nodeFooter}>Agent 节点 <span>↗</span></div>
        </button>)}
      </div> : <div className={styles.empty}><div className={styles.emptyIcon}>⌘</div><h2>{detail.roadmap === null ? "从一个目标，走向一条路线" : "项目路线已创建"}</h2><p>{detail.roadmap === null ? "规划完成后，你的任务、依赖与进度会在这里展开。" : "路线地图展示即将开放，已有路线数据会继续保留。"}</p>{demo && <button onClick={() => setPlanned(true)}>查看示例路线 <span>→</span></button>}</div>}
    </div>
    <div className={styles.mapFoot}><span><i /> {demo ? "示例数据" : project.status === "active" ? "进行中" : "已归档"}</span><button disabled={!planned} onClick={resetView}>◎ 回到工作节点</button>{demo && <button onClick={() => setPlanned(value => !value)}>{planned ? "查看规划前空态" : "显示示例路线"}</button>}{planned && <span className={styles.dragHint}>按住左键拖拽地图</span>}</div>
    {!visible && <button className={styles.restore} aria-label="展开会话面板" onClick={() => setVisible(true)}>◫ <span>{title}</span> ‹</button>}
    {visible && <aside ref={panel} className={styles.panel} data-full={full} aria-label="项目会话面板">
      <nav className={styles.rail} aria-label="项目内会话">
        <button className={styles.mainButton} aria-label="切换到 Main" aria-pressed={active === "main"} onClick={() => setActive("main")}>M</button>
        <div className={styles.railDivider} />
        {opened.map(id => <div key={id} className={styles.railNode} data-active={active === id}>
          <button title={nodes.find(item => item.id === id)?.title} aria-label={`切换到 ${nodes.find(item => item.id === id)?.title}`} onClick={() => setActive(id)}>{nodes.findIndex(item => item.id === id) + 1}</button>
          <button className={styles.closeNode} aria-label={`关闭 ${nodes.find(item => item.id === id)?.title}`} onClick={() => closeNode(id)}>×</button>
        </div>)}
        <span className={styles.railBottom}>N</span>
      </nav>
      <div className={styles.conversation}>
        <header className={styles.panelHeader}><div><strong>{title}</strong><small>{node ? "Node · 节点工作会话" : "主协调 Agent"}</small></div><div className={styles.actions}>
          <button aria-label={full ? "恢复普通宽度" : "完全展开会话面板"} title={full ? "恢复普通宽度" : "完全展开"} onClick={() => setFull(value => !value)}>{full ? "⊡" : "⛶"}</button>
          <button aria-label="收起会话面板" title="收起会话面板" onClick={() => setVisible(false)}>›</button>
        </div></header>
        <nav className={styles.auxiliary} aria-label="项目辅助信息"><details><summary>项目信息</summary><dl><dt>工作目录</dt><dd><code>{project.workspaceRoot ?? "绑定中"}</code></dd><dt>状态</dt><dd>{project.status === "active" ? "进行中" : "已归档"}</dd><dt>创建时间</dt><dd><time dateTime={project.createdAt}>{new Date(project.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></dd></dl></details><button disabled title="消息查看即将开放">消息</button><button disabled title="资源查看即将开放">资源</button></nav>
        <div className={styles.messages}>
          <div className={styles.context}><span>{node ? "当前节点" : "项目目标"}</span><p>{node?.note ?? project.goal ?? "目标待确定"}</p>{node && <small>验收条件：提供可检查的结果与来源证据。</small>}</div>
          {demo ? <div className={styles.assistant}><div className={styles.author}>{node ? "NODE" : "MAIN"}<span> · 工作会话</span></div><p>{node ? `我们将围绕「${node.title}」展开工作。你可以补充要求，或明确发起这一步的执行。` : "我们先确认这项研究的目标与边界，再把它拆成可以逐步执行和验证的路线。"}</p><p>{node ? "切回 Main 可以讨论整体路线。关闭这个会话入口后，草稿与内容仍会保留。" : "规划完成后，点击路线上的任意节点，就能在这里切换到它的工作会话。"}</p></div> : <div className={styles.assistant}><p>项目对话即将开放。你可以先在下方准备草稿，切换项目后草稿仍会保留。</p>{detail.main.turnActive && <p>后端 Main 回合正在运行，对话过程展示尚未接入。</p>}</div>}
          {(messages[active] ?? []).map((message, index) => <div key={index} className={message.role === "user" ? styles.user : styles.assistant}>{message.text}</div>)}
          {demo && !node && !planned && <button className={styles.planButton} onClick={() => setPlanned(true)}>生成示例路线 <span>↗</span></button>}
          {node && <div className={styles.nodeHint}>原型仅展示交互，不启动 Agent 或修改节点状态。</div>}
        </div>
        <div className={styles.composer}><textarea aria-label={`${title} 草稿`} placeholder={node ? "补充这个节点的要求…" : "与 Main 讨论目标与路线…"} value={drafts[active] ?? ""} onChange={event => setDrafts(previous => ({ ...previous, [active]: event.target.value }))} /><div><span>{demo ? "原型演示 · 不调用模型" : "草稿 · 对话发送即将开放"}</span><button aria-label={demo ? "发送示例消息" : "发送消息"} disabled={!demo || !drafts[active]?.trim()} onClick={send}>↑</button></div></div>
      </div>
    </aside>}
  </article>;}
