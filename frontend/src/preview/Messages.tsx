import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { MessageList } from "../workspace/chat/List.js";
import type { AssistantContentBlock, AssistantToolBlock, CommandConversationMessage } from "../workspace/chat/conversation.js";
import "../styles.css";
import styles from "./messages/style.module.css";

type Playback = { readonly mode: "play" | "hold" | "complete"; readonly epoch: number };

function Demo(): React.JSX.Element {
  const [playback, setPlayback] = useState<Playback>(() => ({ mode: "hold", epoch: Date.now() - 20_000 }));
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (playback.mode !== "play") return undefined;
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= playback.epoch + 34_000) window.clearInterval(timer);
    }, 60);
    return () => window.clearInterval(timer);
  }, [playback]);
  const elapsed = playback.mode === "hold" ? 20_000
    : playback.mode === "complete" ? 34_000 : Math.max(0, now - playback.epoch);
  const complete = elapsed >= 34_000;
  const data = sample(elapsed, playback.epoch);
  const select = (mode: Playback["mode"]): void => {
    const time = Date.now();
    setNow(time);
    setPlayback({ mode, epoch: time - (mode === "hold" ? 20_000 : mode === "complete" ? 34_000 : 0) });
  };

  return (
    <div className={styles.demo}>
      <header className={styles.topbar}>
        <div className={styles.brand}>NAVO<span>.</span></div>
        <span className={styles.badge}>消息体验 · MOCK</span>
      </header>
      <aside className={styles.controls} aria-label="演示控制">
        <div className={styles.actions}>
          <button id="replay" onClick={() => select("play")} aria-pressed={playback.mode === "play" && !complete}>重播完整过程</button>
          <button id="hold" onClick={() => select("hold")} aria-pressed={playback.mode === "hold"}>停留执行中</button>
          <button id="finish" onClick={() => select("complete")} aria-pressed={complete}>查看完成结果</button>
          <span className={styles.badge}>增强高亮已启用</span>
        </div>
        <p>{playback.mode === "hold" ? "正在持续展示工具与通知的运行态。点“重播”查看思考吐字，点“完成”体验折叠。"
          : complete ? "过程已自动收起，点击“已处理”右侧箭头展开。最终回答始终独立显示。"
            : "思考 → 搜索 → 中间说明 → 思考 → Shell → 最终回答，约 34 秒。"}</p>
        <p className={styles.motion}>系统已开启“减少动态效果”，动画按系统偏好停用。</p>
      </aside>
      <main className={styles.conversation} aria-label="Mock 消息演示">
        <MessageList key={playback.epoch} messages={[
          { id: "user", role: "user", text: "请检索 Adaptive Roadmap 的相关资料，检查本地演示项目，并整理一份简短结论。" },
          { id: "assistant", role: "assistant", text: data.answer, blocks: data.blocks,
            status: complete ? "completed" : "streaming", failure: null,
            startedAt: playback.epoch, endedAt: complete ? playback.epoch + 34_000 : null },
        ]} commands={data.commands} timeline={[
          { kind: "message", id: "user" },
          { kind: "message", id: "assistant" },
          ...data.commands.map((command) => ({ kind: "command" as const, id: command.id })),
        ]} />
      </main>
      <footer className={styles.footer}>全部为演示数据，不发送模型请求，不执行 Shell 或文件操作。默认使用当前生产组件与高亮样式。</footer>
    </div>
  );
}

function sample(elapsed: number, epoch: number): {
  blocks: AssistantContentBlock[];
  commands: CommandConversationMessage[];
  answer: string;
} {
  const blocks: AssistantContentBlock[] = [];
  const commands: CommandConversationMessage[] = [];
  const reasoning = (id: string, text: string, start: number, end: number): void => {
    if (elapsed < start) return;
    blocks.push({ id, kind: "reasoning", text: reveal(text, elapsed, start, end), status: elapsed < end ? "streaming" : "completed" });
  };
  const tool = (id: string, name: string, args: string, summary: string, detail: string, start: number, end: number): void => {
    if (elapsed < start) return;
    const status = elapsed < start + 500 ? "pending" : elapsed < end ? "running" : "succeeded";
    const block: AssistantToolBlock = {
      id, kind: "tool-call", toolCallId: id, toolName: name, arguments: args, status,
      startedAt: status === "pending" ? null : epoch + start + 500,
      endedAt: elapsed >= end ? epoch + end : null,
      summary: elapsed >= end ? summary : "", detail: elapsed >= end ? detail : "", failure: null,
    };
    blocks.push(block);
  };
  reasoning("reasoning-a", "先把任务拆成两部分：查找相关研究，再检查项目结构。检索结果只作为线索，我会核对来源后再形成结论。", 0, 5_000);
  tool("search", "web_search", '{"query":"adaptive roadmap long horizon agents"}', "找到 3 条相关资料（Mock）。", "1. 动态任务规划\n2. 基于证据的验证\n3. 执行失败后的局部重规划", 5_000, 11_000);
  if (elapsed >= 11_000) blocks.push({ id: "intermediate", kind: "text", text: "已找到相关资料。接下来检查项目中的示例文件，确认规划与验证是否分开组织。", status: "completed" });
  tool("fetch", "web_fetch", '{"url":"https://example.com/research"}', "已读取研究页面。", "页面摘要：规划与验证应分离。此处为 Mock 网页正文。", 11_000, 12_000);
  tool("read", "read", '{"path":"package.json"}', "已读取文件。", "文件内容无需展开。", 12_000, 13_000);
  tool("edit", "edit", '{"path":"demo.ts"}', "编辑完成。", "编辑结果无需展开。", 13_000, 14_000);
  tool("write", "write", '{"path":"report.txt"}', "写入完成。", "写入结果无需展开。", 14_000, 15_000);
  reasoning("reasoning-b", "搜索结果指出，任务完成需要独立证据。现在查看示例目录和测试结果，再区分已有能力与下一步要补充的内容。", 12_000, 18_000);
  tool("shell", "shell", JSON.stringify({ command: "pnpm test --run --reporter=verbose --project=navo-demo --testNamePattern=roadmap-validation-and-evidence-linking", timeoutMs: 60_000 }),
    "检查完成：11 项通过，1 项未通过。",
    Array.from({ length: 20 }, (_, index) => `PASS  roadmap / case ${index + 1}`).join("\n")
      + "\nFAIL  verification requires evidence: expected artifact path to point to a readable result; received an empty path in the example fixture.\n\nMock output only; no command was executed.\n[exit code: 1]", 18_000, 26_000);
  if (elapsed >= 19_000) commands.push({ id: "notice", role: "system", commandId: "notice", name: "hello",
    anchor: { kind: "session" }, status: elapsed < 26_000 ? "running" : "succeeded",
    summary: elapsed < 26_000 ? "会话通知与工具使用相同的状态行，独立于回合过程。" : "hello · 会话命令已完成（Mock）。",
    startedAt: epoch + 19_000, endedAt: elapsed < 26_000 ? null : epoch + 26_000, failure: null });
  if (elapsed >= 26_000) {
    commands.push({ id: "failed", role: "system", commandId: "failed", name: "unknown",
      anchor: { kind: "session" }, status: "failed", summary: "", failure: { code: "unknown-command", message: "未知命令 /unknown（失败状态演示）。" }, startedAt: epoch + 24_000, endedAt: epoch + 25_000 });
    commands.push({ id: "cancelled", role: "system", commandId: "cancelled", name: "hello",
      anchor: { kind: "session" }, status: "cancelled", summary: "用户已停止本次命令（取消状态演示）。", failure: null, startedAt: epoch + 24_000, endedAt: epoch + 26_000 });
  }
  const answer = elapsed < 26_000 ? "" : reveal([
    "### 检查结论", "", "**规划、执行和验证应该保持独立。** 本次演示完成了资料检索与项目检查，两个工具的输出都保留在上方过程里。", "",
    "| 检查项 | 演示结果 |", "| --- | --- |", "| 资料检索 | 3 条相关线索 |", "| 项目测试 | 11 项通过，1 项未通过 |", "| 后续工作 | 补充可复查的验证证据 |", "",
    "建议下一步：", "1. 为每个任务记录完成条件。", "2. 将输出与证据关联，验证后再推进路线。", "",
    "```text", "Goal -> Roadmap -> Execution -> Evidence -> Verification", "```", "", "这些结论与数字均为 Mock 数据，仅用于展示消息排版。",
  ].join("\n"), elapsed, 26_000, 34_000);
  if (answer) blocks.push({ id: "answer", kind: "text", text: answer, status: elapsed < 34_000 ? "streaming" : "completed" });
  return { blocks, commands, answer };
}

function reveal(text: string, elapsed: number, start: number, end: number): string {
  return text.slice(0, Math.floor(text.length * Math.min(1, Math.max(0, (elapsed - start) / (end - start)))));
}

const root = document.getElementById("root");
if (root === null) throw new Error("Missing demo root");
createRoot(root).render(<Demo />);
