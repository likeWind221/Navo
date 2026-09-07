import { useState } from "react";
import type { SubmitEvent, KeyboardEvent } from "react";
import { Icon } from "../../ui/Icon";
import styles from "../style.module.css";

export function Composer({ onSubmit, busy, onCancel }: {
  readonly onSubmit: (text: string) => boolean;
  readonly busy: boolean;
  readonly onCancel: () => boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");

  function submit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0) return;
    if (onSubmit(text)) setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form className={styles.composer} onSubmit={submit}>
      <label className={styles.srOnly} htmlFor="chat-input">消息草稿</label>
      <textarea id="chat-input" value={draft} onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown} placeholder="输入你想探索的问题…" maxLength={8000}
        aria-describedby="chat-help" rows={2} />
      <div className={styles.composerFooter}>
        <small id="chat-help">{busy ? "Agent 正在生成，可以继续编辑草稿" : "Enter 发送，Shift + Enter 换行"}</small>
        <button type={busy ? "button" : "submit"} onClick={busy ? onCancel : undefined}
          disabled={!busy && !draft.trim()} className={busy ? styles.stopButton : undefined}
          aria-label={busy ? "停止生成" : "发送消息"} title={busy ? "停止当前 Agent 回复" : "发送给 Agent"}>
          {busy ? <span className={styles.stopIcon} aria-hidden="true" /> : <Icon name="arrow" />}
        </button>
      </div>
    </form>
  );
}
