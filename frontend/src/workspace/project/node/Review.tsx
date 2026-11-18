import { useState } from "react";
import type { NodeV1 } from "../../../../../rpc/project.js";
import { PROJECT_REVIEW_REASON_MAX_CHARS } from "../../../../../rpc/project.js";
import type { DesktopProjectFailure } from "../../../../shared/project.js";
import { projectFailureMessage } from "../failure";
import styles from "./style.module.css";

export type NodeReviewAction = "complete" | "rework" | "skip";

export interface NodeReviewControls {
  readonly busy: boolean;
  readonly failure: DesktopProjectFailure | null;
  readonly mainReviewBusy: boolean;
  readonly onReview: (action: NodeReviewAction, reason: string) => Promise<boolean>;
  readonly onAskMain: () => void;
  readonly onDismissFailure: () => void;
}

const actionLabels: Readonly<Record<NodeReviewAction, string>> = {
  complete: "确认完成",
  rework: "退回修改",
  skip: "跳过节点",
};

const decisionLabels: Readonly<Record<NonNullable<NodeV1["review"]>["decision"], string>> = {
  complete: "完成",
  rework: "返工",
  skip: "跳过",
  escalate: "交给人工",
};

export function NodeReview({ node, controls }: { readonly node: NodeV1; readonly controls?: NodeReviewControls | undefined }): React.JSX.Element {
  const [selected, setSelected] = useState<NodeReviewAction | null>(null);
  const [reason, setReason] = useState("");
  const busy = controls?.busy ?? false;

  function choose(action: NodeReviewAction): void {
    setSelected(action);
    setReason(action === "rework" ? "" : action === "skip" ? "人工决定跳过" : "人工验收通过");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (selected === null || controls === undefined) return;
    const text = reason.trim();
    if (!text) return;
    if (await controls.onReview(selected, text)) {
      setSelected(null);
      setReason("");
    }
  }

  return <section className={styles.review} aria-label="节点验收">
    {controls?.failure !== null && controls?.failure !== undefined && <div className={styles.failure} role="alert">
      <span>{projectFailureMessage(controls.failure)}</span>
      <button type="button" onClick={controls.onDismissFailure}>知道了</button>
    </div>}
    <div className={styles.reviewSummary}>
      <span className={styles.reviewBadge} data-status={node.status}>{node.reviewPending ? "待复盘" : node.status === "submitted" ? "待验收" : "验收记录"}</span>
      <span>已返工 {node.reworkCount} 次</span>
      {controls?.mainReviewBusy === true && <span className={styles.reviewRunning}>Main 正在复盘</span>}
    </div>
    {node.reviewPending && <p className={styles.pending}>最近一回合已结束，等待人工验收或 Main 复盘。</p>}

    {node.pendingFeedback !== null && <section className={styles.reviewBlock} aria-label="未读返工意见">
      <h3>返工意见 <small>Node 尚未读取</small></h3>
      <p>{node.pendingFeedback.feedback}</p>
      <p className={styles.meta}>{node.pendingFeedback.requestedBy} · 版本 {node.pendingFeedback.reviewedRevision} · {formatTime(node.pendingFeedback.requestedAt)}</p>
    </section>}

    {node.submission === null ? <section className={styles.reviewBlock} aria-label="作业单">
      <h3>作业单</h3>
      <p className={styles.muted}>{node.status === "submitted" ? "Node 已交作业，但没有可展示的作业摘要。" : "当前还没有提交作业。"}</p>
    </section> : <section className={styles.reviewBlock} aria-label="作业单">
      <h3>作业单 <small>Node 提交的完成判断</small></h3>
      <p className={styles.summary}>{node.submission.summary}</p>
      <p className={styles.meta}>提交时间：{formatTime(node.submission.submittedAt)}</p>
      <h4>产物</h4>
      {node.submission.resourceIds.length > 0
        ? <ul className={styles.artifacts}>{node.submission.resourceIds.map(resourceId => <li key={resourceId}><code>{resourceId}</code></li>)}</ul>
        : <p className={styles.muted}>未提供产物 Resource。</p>}
      <h4>完成标准自查</h4>
      {node.submission.criteria.length > 0
        ? <ul className={styles.checks}>{node.submission.criteria.map((check, index) => <li key={`${index}-${check.criterion}`} data-satisfied={check.satisfied}>
          <span>{check.satisfied ? "满足" : "未满足"}</span>
          <div><strong>{check.criterion}</strong><small>{check.note || "无附注"}</small></div>
        </li>)}</ul>
        : <p className={styles.muted}>没有提交逐条自查。</p>}
      <h4>未完成事项</h4>
      {node.submission.remaining.length > 0
        ? <ul className={styles.remaining}>{node.submission.remaining.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        : <p className={styles.muted}>没有未完成事项。</p>}
    </section>}

    {node.review !== null && <section className={styles.reviewBlock} aria-label="最近复盘">
      <h3>最近复盘 <small>{decisionLabels[node.review.decision]}</small></h3>
      <p>{node.review.reason}</p>
      <p className={styles.meta}>被审版本 {node.review.reviewedRevision} · {formatTime(node.review.reviewedAt)}</p>
    </section>}

    {node.confirmation !== null && <section className={styles.reviewBlock} aria-label="人工验收记录">
      <h3>人工确认记录</h3>
      <p>{node.confirmation.reason}</p>
      <p className={styles.meta}>{node.confirmation.confirmedBy} · 版本 {node.confirmation.reviewedRevision}</p>
    </section>}

    <section className={styles.reviewActions} aria-label="验收操作">
      <h3>验收操作</h3>
      <div className={styles.actionButtons}>
        {(Object.keys(actionLabels) as NodeReviewAction[]).map(action => <button key={action} type="button"
          data-action={action} disabled={controls === undefined || busy || controls?.mainReviewBusy === true || !node.actions[action]} onClick={() => choose(action)}
          title={node.actions[action] ? undefined : "后端当前未开放此操作"}>
          {actionLabels[action]}
        </button>)}
        <button type="button" data-action="review" disabled={controls === undefined || busy || controls?.mainReviewBusy === true || !node.actions.review} onClick={() => controls?.onAskMain()}
          title={node.actions.review ? undefined : "后端当前未开放此操作"}>请 Main 复盘</button>
      </div>
      {selected !== null && <form className={styles.reviewForm} onSubmit={event => void submit(event)}>
        <label>{selected === "rework" ? "返工意见（必填）" : "验收理由（必填）"}
          <textarea autoFocus value={reason} maxLength={PROJECT_REVIEW_REASON_MAX_CHARS} onChange={event => setReason(event.target.value)}
            placeholder={selected === "rework" ? "说明需要 Node 修改什么…" : "记录这次验收判断的依据…"} />
        </label>
        <div><button type="button" onClick={() => { setSelected(null); setReason(""); }}>取消</button>
          <button type="submit" disabled={busy || !reason.trim()}>{busy ? "提交中…" : actionLabels[selected]}</button></div>
      </form>}
      {controls === undefined && <p className={styles.muted}>验收操作仅在桌面应用中可用。</p>}
      {controls !== undefined && !node.actions.complete && !node.actions.rework && !node.actions.skip && !node.actions.review && !busy && <p className={styles.muted}>当前没有可用的验收操作。</p>}
    </section>
  </section>;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
