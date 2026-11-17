import type { NodeV1, RoadmapV1 } from "../../../../rpc/project.js";
import { Icon } from "../../ui/Icon";
import { stateSymbols, statusLabels as labels } from "./map/model";
import styles from "./node/style.module.css";

const actionLabels = { run: "开始或继续执行", complete: "确认完成", skip: "跳过节点", rework: "退回修改", review: "请 Main 复盘" };

export function NodeDetails({ node, roadmap, onOpen }: { readonly node: NodeV1; readonly roadmap: RoadmapV1; readonly onOpen: (id: string) => void }): React.JSX.Element {
  const predecessors = roadmap.edges.filter(edge => edge.to === node.nodeId).map(edge => edge.from);
  const successors = roadmap.edges.filter(edge => edge.from === node.nodeId).map(edge => edge.to);
  const actions = (Object.keys(actionLabels) as (keyof typeof actionLabels)[]).filter(action => node.actions[action]);
  return <section className={styles.details} aria-label="节点详情">
    <div className={styles.badges}><span data-status={labels[node.status]}>{stateSymbols[labels[node.status]]} {labels[node.status]}</span><span>{node.requirement === "optional" ? "可选节点" : "必选节点"}</span></div>
    <h2>{node.title}</h2>
    <section><h3>节点目标</h3><p>{node.description}</p></section>
    <section><h3>完成标准</h3>{node.acceptanceCriteria.length ? <ul>{node.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul> : <p className={styles.muted}>尚未提供完成标准</p>}</section>
    <section><h3>前置节点 <small>{predecessors.length}</small></h3><Relations ids={predecessors} roadmap={roadmap} onOpen={onOpen} empty="没有前置任务" /></section>
    <section><h3>后续节点 <small>{successors.length}</small></h3><Relations ids={successors} roadmap={roadmap} onOpen={onOpen} empty="没有后续任务" /></section>
    <section className={styles.actions}><h3>当前可用操作</h3>{actions.length ? <><div>{actions.map(action => <span key={action}>{actionLabels[action]}</span>)}</div><p className={styles.muted}>{node.actions.run ? "执行入口已开放：在下方发送消息开始或继续这个节点。" : "当前仅展示可用操作，执行入口需等待后端允许。"} 确认、返工、跳过和复盘仍在后续步骤接入。</p></> : <p className={styles.muted}>{node.status === "locked" ? "当前没有可用操作，等待前置任务解锁。" : "当前没有可用操作。"}</p>}</section>
  </section>;
}

function Relations({ ids, roadmap, onOpen, empty }: { readonly ids: readonly string[]; readonly roadmap: RoadmapV1; readonly onOpen: (id: string) => void; readonly empty: string }): React.JSX.Element {
  const nodes = roadmap.nodes.filter(node => ids.includes(node.nodeId));
  return nodes.length ? <div className={styles.relations}>{nodes.map(node => <button key={node.nodeId} onClick={() => onOpen(node.nodeId)}><span>{String(roadmap.nodes.indexOf(node) + 1).padStart(2, "0")}</span><span>{node.title}<small>{labels[node.status]}</small></span><Icon name="arrow" /></button>)}</div> : <p className={styles.muted}>{empty}</p>;
}
