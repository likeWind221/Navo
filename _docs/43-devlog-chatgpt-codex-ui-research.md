# ChatGPT / Codex 式过程 UI 开源参考调研

## 做了什么

为“思考 / 工具 / 通知”三块过程 UI 寻找可直接参考的开源实现，按“是否 React、是否实现完整折叠生命周期、许可证是否可借鉴”筛选，只读阅读了四个项目的真实源码。

| 项目 | 许可 | 阅读的关键源码 |
|---|---|---|
| `vercel/ai-elements` | Apache-2.0 | `packages/elements/src/reasoning.tsx`、`tool.tsx`、`chain-of-thought.tsx` |
| `assistant-ui/assistant-ui` | MIT | `packages/ui/src/components/react/assistant-ui/elements/reasoning.tsx`、`packages/react/src/primitives/chainOfThought/*` |
| `lobehub/lobehub` | LobeHub Community License（Apache-2.0 + 附加商业条款） | `src/features/Conversation/components/Thinking/{index,Title,StatusIndicator}.tsx`、`Messages/AssistantGroup/{index.tsx,components/Group.tsx,components/WorkflowCollapse.tsx,components/ProcessFold.tsx,toolDisplayNames.ts}` |
| `openai/codex` | Apache-2.0 | `codex-rs/tui/src/chatwidget.rs`、`chatwidget/snapshots/*reasoning*.snap`、`history_cell/notices.rs` |

## 关键发现

用户描述的三个行为在开源实现里有对应的、可复用的机制。

1. **思考流出现后，“思考中”被 reasoning 内容替换**：LobeHub `toolDisplayNames.ts` 的 `getWorkflowStreamingHeadlineState` 从最后一块开始回退，思考块尚未产出正文时提取 reasoning 的最后一个 Markdown 标题作为行标题（`extractMarkdownHeadingTitle`）；取不到才退回 “Working…”。Codex CLI 同样维护 `reasoning_buffer` / `reasoning_header`，活动行渲染为 `• Preparing evidence report (42s • esc to interrupt)`。
2. **流式期间自动展开、结束后自动折叠**：`ai-elements/reasoning.tsx` 用 `defaultOpen ?? isStreaming` 自动展开，流结束后延迟 1s 自动折叠一次；`assistant-ui` 的 `ReasoningRoot` 用 `streaming` 属性在流式期间强制展开、结束后回到 `defaultOpen`，并把首次手动切换视为永久接管。触发标签在流式时是 shimmer 的 “Thinking…”，结束后替换为 “Thought for N seconds”。
3. **最终回答出现后整段过程折叠**：LobeHub `Group.tsx` 用 `splitAssistantGroupFinalAnswer` 把回合切成 process / final 两段，`shouldFoldProcess` 判定“操作已结束 + 不在生成中 + 非最后回合或已有最终回答”后，把 process 段整体塞进 `ProcessFold`（`已处理 {duration}`，可再次展开），final 段始终可见。

## 与 SkillWorld 当前实现的差异

- 现状：`ReasoningBlock` 是固定 `<details>`，标题恒为“思考中 / 思考过程”；`ToolBlock` 是独立卡片；两者不会在回答开始后自动折叠，也没有回合级汇总行。
- 参考实现的核心不是单个组件的样式，而是按回合分组的状态机：streaming 阶段（半展开 + shimmer 标题 + 计时）→ completed 阶段（折叠成一行摘要 + 用时）→ 最终回答独立渲染。
- `WorkflowCollapse.tsx` 里有两处值得照搬的工程细节：折叠动画与“整段快照替换”不能同时发生（`suppressAutoCollapse`，否则完成瞬间会抖动两次）；手动展开过的回合不再被自动折叠（`userOpenedRef`）。

## 坑与发现

- 本机直连 GitHub API 超时，需要走本机代理 `http://127.0.0.1:7897`（Clash/mihomo 混合端口）。
- GitHub 未认证 API 限额 60 次/小时，超限后改用 `https://ungh.cc` 取仓库元数据与文件清单、`raw.githubusercontent.com` 取源码。
- LobeHub 已把许可从 MIT/Apache 收紧为 LobeHub Community License，抄代码前须注意；`ai-elements`、`assistant-ui`、`codex` 分别为 Apache-2.0 / MIT / Apache-2.0。
- Codex 桌面 App 未开源；可读的是 Codex CLI（Rust TUI）与 `app-server` 协议，视觉细节需自行复刻，行为语义可以从 CLI 快照测试反推。

## 下一步

按 `frontend-plan.md` 新增前端阶段，把“过程折叠”做成独立 Step：先实现回合级 process / final 分组与折叠状态机，再改造 reasoning 与 tool 的流式标题，最后统一通知行样式。
