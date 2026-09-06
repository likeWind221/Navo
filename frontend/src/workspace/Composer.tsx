import { useState } from "react";
import type { SubmitEvent, KeyboardEvent } from "react";
import { Icon } from "../ui/Icon";
import styles from "./Workspace.module.css";

export function Composer({ onSubmit }: { onSubmit: (text: string) => void }): React.JSX.Element {
  const [draft, setDraft] = useState("");

  function submit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSubmit(text);
    setDraft("");
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
        onKeyDown={handleKeyDown} placeholder="聊聊你想探索的事情……" maxLength={8000}
        aria-describedby="chat-help" rows={2} />
      <div className={styles.composerFooter}>
        <small id="chat-help">Enter 添加消息，Shift + Enter 换行</small>
        <button type="submit" disabled={!draft.trim()} aria-label="添加消息到本地对话" title="添加到本地对话，不发送至 Agent">
          <Icon name="arrow" />
        </button>
      </div>
    </form>
  );
}
