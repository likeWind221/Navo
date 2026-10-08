import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, SyntheticEvent } from "react";

import type { ProjectCreateInput, ProjectSummaryV1 } from "../../../../rpc/project.js";
import { PROJECT_GOAL_MAX_CHARS, PROJECT_NAME_MAX_CHARS } from "../../../../rpc/project.js";
import type { DesktopProjectApi, DesktopProjectResult } from "../../../shared/project.js";
import { checkDraft, emptyDraft } from "./draft";
import type { ProjectDraft } from "./draft";
import { projectFailureMessage } from "./failure";
import { missingBridge } from "./hook";
import styles from "./style.module.css";

export function ProjectCreate({ api, create, onCreated, onClose }: {
  readonly api: DesktopProjectApi | undefined;
  readonly create: (input: ProjectCreateInput) => Promise<DesktopProjectResult<ProjectSummaryV1>>;
  readonly onCreated: (projectId: string) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<ProjectDraft>(emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
    return () => element?.close();
  }, []);

  function update(patch: Partial<ProjectDraft>): void {
    setDraft(current => ({ ...current, ...patch }));
    setMessage(null);
  }

  async function chooseWorkspace(): Promise<void> {
    if (busy.current) return;
    if (api === undefined) {
      setMessage(projectFailureMessage(missingBridge));
      return;
    }
    setChoosing(true);
    const result = await api.chooseWorkspace();
    setChoosing(false);
    if (result.type === "failed") setMessage(projectFailureMessage(result.failure));
    else if (result.value !== null) update({ workspaceRoot: result.value });
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy.current) return;
    const check = checkDraft(draft);
    if (check.type === "problem") {
      setMessage(check.message);
      return;
    }
    busy.current = true;
    setSubmitting(true);
    const result = await create(check.input);
    busy.current = false;
    setSubmitting(false);
    if (result.type === "ok") onCreated(result.value.projectId);
    else setMessage(projectFailureMessage(result.failure));
  }

  function cancel(event: SyntheticEvent<HTMLDialogElement>): void {
    event.preventDefault();
    if (!busy.current) onClose();
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} onCancel={cancel}>
    <form className={styles.form} onSubmit={event => void submit(event)} noValidate>
      <h2 id={`${id}-title`}>新建项目</h2>
      <label className={styles.field}>
        <span>项目名称</span>
        <input name="name" value={draft.name} maxLength={PROJECT_NAME_MAX_CHARS} disabled={submitting}
          autoComplete="off" onChange={event => update({ name: event.target.value })} />
      </label>
      <label className={styles.field}>
        <span>项目目标（可选）</span>
        <textarea name="goal" value={draft.goal} rows={5} maxLength={PROJECT_GOAL_MAX_CHARS} disabled={submitting}
          placeholder="可留空，之后在对话中与 Main 确认" onChange={event => update({ goal: event.target.value })} />
      </label>
      <div className={styles.field}>
        <span>工作目录</span>
        <div className={styles.workspace}>
          <code title={draft.workspaceRoot ?? undefined}>{draft.workspaceRoot ?? "尚未选择"}</code>
          <button type="button" className={styles.secondary} disabled={submitting || choosing}
            onClick={() => void chooseWorkspace()}>{choosing ? "选择中…" : "选择目录"}</button>
        </div>
      </div>
      <p className={styles.hint}>项目目前只保存在内存中，Host 重启后会清空。</p>
      {message !== null && <p className={styles.error} role="alert">{message}</p>}
      <footer className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={submitting} onClick={onClose}>取消</button>
        <button type="submit" className={styles.primary} disabled={submitting}>{submitting ? "正在创建…" : "创建项目"}</button>
      </footer>
    </form>
  </dialog>;
}
