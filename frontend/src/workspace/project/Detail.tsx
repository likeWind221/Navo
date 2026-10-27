import { useCallback, useEffect, useRef, useState } from "react";

import type { ProjectDetailV1 } from "../../../../rpc/project.js";
import type { DesktopProjectApi, DesktopProjectFailure } from "../../../shared/project.js";
import type { DesktopResourceApi } from "../../../shared/resource.js";
import { projectFailureMessage } from "./failure";
import { missingBridge } from "./hook";
import { ProjectWorkspace } from "./Workspace";
import type { ProjectRuntime } from "./runtime.js";
import styles from "./style.module.css";

export type ProjectDetailState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly detail: ProjectDetailV1 }
  | { readonly status: "failed"; readonly failure: DesktopProjectFailure };

export function ProjectDetail({ api, resource, projectId, runtime }: {
  readonly api: DesktopProjectApi | undefined;
  readonly resource: DesktopResourceApi | undefined;
  readonly projectId: string;
  readonly runtime?: ProjectRuntime | undefined;
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

  return <ProjectDetailView state={state} api={api} resource={resource} runtime={runtime} onRetry={() => void load()} />;
}

export function ProjectDetailView({ state, api, resource, runtime, onRetry }: {
  readonly state: ProjectDetailState;
  readonly api?: DesktopProjectApi | undefined;
  readonly resource?: DesktopResourceApi | undefined;
  readonly runtime?: ProjectRuntime | undefined;
  readonly onRetry: () => void;
}): React.JSX.Element {
  if (state.status === "loading") return <div className={styles.detail}><p role="status">正在读取项目……</p></div>;
  if (state.status === "failed") {
    return <div className={styles.detail}>
      <p className={styles.error} role="alert">{projectFailureMessage(state.failure)}</p>
      <button type="button" className={styles.secondary} onClick={onRetry}>重试</button>
    </div>;
  }
  return <ProjectWorkspace key={state.detail.project.projectId} detail={state.detail} api={api} resource={resource} runtime={runtime} />;
}
