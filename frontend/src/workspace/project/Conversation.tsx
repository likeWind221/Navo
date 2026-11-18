import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ProjectDetailV1 } from "../../../../rpc/project.js";
import { Composer } from "../chat/Composer";
import { MessageList } from "../chat/List";
import { ProjectRuntime } from "./runtime.js";
import type { ProjectChatTarget } from "./runtime/turns.js";
import type { ConversationState } from "../chat/conversation.js";
import { ProjectHistory } from "./History";
import styles from "../style.module.css";

export function ProjectConversation({ runtime, projectId, detail, target, reviewTarget, disabled = false, disabledHint, placeholder, children, afterMessages }: {
  readonly runtime: ProjectRuntime;
  readonly projectId: string;
  readonly detail: ProjectDetailV1;
  readonly target: ProjectChatTarget;
  readonly reviewTarget?: ProjectChatTarget | null;
  readonly disabled?: boolean;
  readonly disabledHint?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly children?: ReactNode;
  readonly afterMessages?: ReactNode;
}): React.JSX.Element {
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const [snapshot, setSnapshot] = useState(() => runtime.targetSnapshot(projectId, target));
  const [reviewSnapshot, setReviewSnapshot] = useState(() => reviewTarget ? runtime.targetSnapshot(projectId, reviewTarget) : null);
  const [historyReady, setHistoryReady] = useState(target.kind === "review");
  const onHistoryReady = useCallback((ready: boolean) => setHistoryReady(ready), []);
  const history = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(snapshot.conversation.messages.length === 0);

  useEffect(() => {
    setSnapshot(runtime.targetSnapshot(projectId, target));
    setReviewSnapshot(reviewTarget ? runtime.targetSnapshot(projectId, reviewTarget) : null);
    return runtime.subscribe(projectId, detailRef.current, () => {
      setSnapshot(runtime.targetSnapshot(projectId, target));
      setReviewSnapshot(reviewTarget ? runtime.targetSnapshot(projectId, reviewTarget) : null);
    });
  }, [runtime, projectId, target, reviewTarget]);
  useLayoutEffect(() => {
    const element = history.current;
    if (element !== null && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [snapshot.conversation.messages, snapshot.conversation.commands, snapshot.conversation.timeline, reviewSnapshot?.conversation, historyReady, afterMessages]);

  function send(text: string): boolean {
    runtime.setDraft(projectId, target, text);
    return runtime.send(projectId, target);
  }

  const conversation = reviewSnapshot ? mergeConversations(snapshot.conversation, reviewSnapshot.conversation) : snapshot.conversation;

  return <section className={styles.chat} aria-label={target.kind === "main" ? "Main 项目对话" : target.kind === "review" ? "Main 复盘对话" : "Node 项目对话"}>
    <div className={styles.history} ref={history} onScroll={(event) => {
      const element = event.currentTarget;
      stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
    }}>{children}{target.kind !== "review" && <ProjectHistory runtime={runtime} projectId={projectId} target={target} mainSessionId={detail.main.sessionId} hasLiveMessages={snapshot.conversation.messages.length > 0} onReady={onHistoryReady} />}{(conversation.messages.length > 0 || conversation.commands.length > 0 || afterMessages) && <MessageList messages={conversation.messages} commands={conversation.commands} timeline={conversation.timeline}>{afterMessages}</MessageList>}</div>
    <div className={styles.inputArea}><Composer value={snapshot.draft} onChange={(value) => runtime.setDraft(projectId, target, value)} inputId={`project-${projectId}-${target.kind === "main" ? "main" : `${target.kind}-${target.nodeId}`}-chat-input`} onSubmit={send} busy={snapshot.busy} disabled={disabled || !historyReady} disabledHint={!historyReady ? "请先读取已保存的对话" : disabledHint} placeholder={placeholder} onCancel={() => runtime.cancel(projectId, target)} /></div>
  </section>;
}

function mergeConversations(first: ConversationState, second: ConversationState): ConversationState {
  const entries = [first, second].flatMap(conversation => conversation.timeline.map((entry, index) => {
    const message = conversation.messages.find(item => item.id === entry.id);
    const nextAssistant = conversation.timeline.slice(index + 1)
      .map(item => conversation.messages.find(candidate => candidate.id === item.id))
      .find(item => item?.role === "assistant");
    const time = message?.role === "assistant" ? message.startedAt
      : message?.role === "user" && nextAssistant?.role === "assistant" ? nextAssistant.startedAt
      : conversation.commands.find(item => item.id === entry.id)?.startedAt ?? 0;
    return { entry, time };
  }));
  entries.sort((a, b) => a.time - b.time);
  return { ...first, messages: [...first.messages, ...second.messages], commands: [...first.commands, ...second.commands], timeline: entries.map(item => item.entry) };
}
