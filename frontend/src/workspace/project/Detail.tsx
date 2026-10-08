import { useCallback, useEffect, useRef, useState } from "react";

import type { ProjectDetailV1, ProjectSummaryV1 } from "../../../../rpc/project.js";
import type { DesktopProjectApi, DesktopProjectFailure } from "../../../shared/project.js";
import { projectFailureMessage } from "./failure";
import { missingBridge } from "./hook";
import styles from "./style.module.css";

export type ProjectDetailState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly detail: ProjectDetailV1 }
  | { readonly status: "failed"; readonly failure: DesktopProjectFailure };

export function ProjectDetail({ api, projectId }: {
  readonly api: DesktopProjectApi | undefined;
  readonly projectId: string;
}): React.JSX.Element {
  const [state, setState] = useState<ProjectDetailState>({ status: "loading" });
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    if (api === undefined) {
      setState({ status: "failed", failure: missingBridge });
      return;
    }
    setState({ status: "loading" });
    const result = await api.get({ projectId });
    if (current !== generation.current) return;
    setState(result.type === "ok" ? { status: "ready", detail: result.value } : { status: "failed", failure: result.failure });
  }, [api, projectId]);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  return <ProjectDetailView state={state} onRetry={() => void load()} />;
}

export function ProjectDetailView({ state, onRetry }: {
  readonly state: ProjectDetailState;
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (state.status === "loading") return <div className={styles.detail}><p role="status">正在读取项目……</p></div>;
  if (state.status === "failed") {
    return <div className={styles.detail}>
      <p className={styles.error} role="alert">{projectFailureMessage(state.failure)}</p>
      <button type="button" className={styles.secondary} onClick={onRetry}>重试</button>
    </div>;
  }
  const project = state.detail.project;
  return <article className={styles.detail} aria-label={`项目 ${project.name}`}>
    <h2>{project.name}</h2>
    <dl className={styles.facts}>
      <dt>目标</dt>
      <dd className={styles.goal}>{project.goal ?? "目标待确定"}</dd>
      <dt>工作目录</dt>
      <dd><code>{project.workspaceRoot ?? "绑定中"}</code></dd>
      <dt>状态</dt>
      <dd>{statusLabel(project.status)}</dd>
      <dt>创建时间</dt>
      <dd><time dateTime={project.createdAt}>{formatTime(project.createdAt)}</time></dd>
    </dl>
  </article>;
}

function statusLabel(status: ProjectSummaryV1["status"]): string {
  switch (status) {
    case "active":
      return "进行中";
    case "archived":
      return "已归档";
  }
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
