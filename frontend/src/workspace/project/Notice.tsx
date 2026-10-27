import type { ProjectListState } from "./hook";
import { projectFailureMessage } from "./failure";
import styles from "./style.module.css";

export function ProjectNotice({ state, onRetry }: {
  readonly state: ProjectListState;
  readonly onRetry: () => void;
}): React.JSX.Element | null {
  if (state.status === "failed" && state.failure !== null) {
    return <div className={styles.notice} role="alert">
      <p>{projectFailureMessage(state.failure)}</p>
      <button type="button" className={styles.link} onClick={onRetry}>重新加载</button>
    </div>;
  }
  if (state.projects.length > 0) return null;
  if (state.status === "loading") return <p className={styles.notice} role="status">正在加载项目……</p>;
  return <p className={styles.notice}>暂无项目。已创建的项目会在 Host 重启后恢复；如果看不到项目，请重新加载。</p>;
}
