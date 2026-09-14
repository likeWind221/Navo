import { useEffect, useState } from "react";

import { Icon, type IconName } from "../../../ui/Icon.js";
import { formatDuration } from "../process.js";
import styles from "../../style.module.css";

export function Activity({ label, status, startedAt, endedAt, icon, disclosure }: {
  readonly label: string;
  readonly status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  readonly icon?: IconName;
  readonly disclosure?: { readonly expanded: boolean; readonly controls: string; readonly onToggle: () => void };
}): React.JSX.Element {
  const [now, setNow] = useState(Date.now);
  const active = status === "running" || status === "pending";
  useEffect(() => {
    if (!active || startedAt === null || endedAt !== null) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, startedAt, endedAt]);

  const presentation: Record<typeof status, { icon: IconName; text: string }> = {
    pending: { icon: "tool", text: "等待执行" },
    running: { icon: "loader", text: "执行中" },
    succeeded: { icon: "check", text: "已完成" },
    failed: { icon: "close", text: "失败" },
    cancelled: { icon: "close", text: "已取消" },
  };
  const current = presentation[status];
  return (
    <div className={styles.activityRow} data-status={status}>
      <span className={styles.activityIcon} data-icon={icon ?? current.icon}
        data-spinning={icon === undefined && status === "running"}><Icon name={icon ?? current.icon} active={active} /></span>
      <span className={styles.activityLabel} data-active={active} title={label}>{label}</span>
      <span className={styles.activityStatus} role="status">{current.text}</span>
      {startedAt !== null && (endedAt !== null || active) && (
        <span className={styles.activityTime}>{formatDuration((endedAt ?? now) - startedAt)}</span>
      )}
      {disclosure !== undefined && (
        <button type="button" className={styles.resultToggle} aria-expanded={disclosure.expanded}
          aria-controls={disclosure.controls} aria-label={`${disclosure.expanded ? "收起" : "展开"} ${label} 的结果`}
          onClick={disclosure.onToggle}><Icon name="chevron" /></button>
      )}
    </div>
  );
}
