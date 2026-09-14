# 前端开发进度总览

**基线提交：** `294d624`  
**范围：** Electron Main、Preload、Renderer、Kernel Host 接入和桌面验收。

## 1. 当前结论

前端已经完成 F0–F2.7：从静态工作区推进到真实 Qwen Agent 的流式桌面对话。默认入口通过安全 Preload Bridge 调用 Main，由 Main 管理独立 Kernel Host；Renderer 不接触原始 RPC method、Provider 凭据或后端 Cordis Context。

F2 阶段已完成，但恢复/重连、多会话、Markdown、工具调用可视化和长期历史仍是后续功能，不在当前默认能力中。

F3 已完成：公共事件、后端事件对齐、桌面桥接、助手内容、命令反馈和完整链路均已确认通过；后续 F3.7 接通真实模型思考内容，F3.8 修正滚动条出现时的消息列水平偏移，F3.9 让滚动区贯穿顶部栏以下的窗口高度并调整底部输入框间距，F3.10 接入 GFM Markdown 展示，F3.11 接入 KaTeX 数学公式。F3.10 与 F3.11 的自动验收与人工桌面验收均已完成，F3 阶段无待办步骤；F3 之后暂无已冻结的前端实施阶段，需要根据产品优先级重新规划。

## 2. 已完成阶段

| 阶段 | 状态 | 交付物 | 主要入口 |
|---|---|---|---|
| F0.1 | ✅ | Electron + React 工程骨架、安全窗口和 Preload 基线 | `frontend/electron`、`frontend/src` |
| F1.1 | ✅ | 工作区信息架构、Node 对话与内容面板规划 | `12-frontend-information-architecture.md` |
| F1.2 | ✅ | 视觉方向、Tokens、最小样板和交互验收 | `frontend/src/styles`、`frontend/src/preview` |
| F2.1 | ✅ | 通用 Stream RPC v1 契约与双向校验 | `rpc` |
| F2.2 | ✅ | Kernel Host、Qwen SSE 和 Mock Host | `src/host`、`src/llm/adapters/qwen*` |
| F2.3 | ✅ | Main Host 单实例生命周期与 stdio Transport | `frontend/electron/host` |
| F2.4 | ✅ | 最小安全 Agent Bridge 和 cleanup | `frontend/electron/preload/agent.ts` |
| F2.5 | ✅ | Renderer 对话 reducer、请求隔离和终态 | `frontend/src/workspace/chat/conversation.ts` |
| F2.6 | ✅ | 流式消息、Composer、停止按钮和滚动策略 | `frontend/src/workspace` |
| F2.7 | ✅ | 错误映射、超时/崩溃验收和真实 Qwen 验收 | `frontend/qa-output` |
| F3.1–F3.9 | ✅ | 助手内容、工具展示、独立命令通知、桌面桥接、完整链路验收、思考接入、消息列对齐与全高滚动布局 | `frontend/electron`、`frontend/shared/agent`、`frontend/src/workspace`、`rpc` |
| F3.10 | ✅ | GFM Markdown 展示、流式阅读、安全外链边界与 Electron QA | `frontend/src/workspace/chat/Markdown.tsx`、`frontend/shared/link.ts`、`frontend/scripts/qa/markdown.ts` |
| F3.11 | ✅ | 行内/块级数学公式排版、两套语法的流式边界、无效公式与危险命令边界 | `frontend/src/workspace/chat/markdown/**`、`frontend/scripts/qa/markdown.ts` |

F3.10 与 F3.11 的代码、测试、Electron 自动验收和人工桌面验收均已完成，F3 阶段无待办步骤。

详细过程见 [阶段 F1 前端记录](13-devlog-phase-f1-frontend.md) 和 [阶段 F2 合并记录](15-devlog-phase-f2-agent-integration.md)；F2.2 的后端交付证据保留在 [Kernel Host 记录](17-devlog-step-f2-2-kernel-host.md)。

## 3. 当前运行链路

```text
Renderer
  ↓ window.desktop.agent（固定 start/cancel/update）
Preload
  ↓ IPC typed bridge
Electron Main
  ↓ AgentTurnController + StreamRpcClient
Kernel Host 子进程
  ↓ stdin/stdout NDJSON
SkillWorld AgentRuntime
  ↓ Qwen Chat Completions SSE
```

权限边界：Renderer 只能提交用户文本和 requestId；Preload 只暴露固定 Agent API；Main 持有 Host 进程和请求控制器；Host 持有模型凭据和后端工具配置。

## 4. Renderer 状态模型

当前单会话状态包含：

- 用户消息；
- 当前 Assistant 占位消息；
- `idle`、`starting`、`streaming`、`completed`、`cancelled`、`failed`、`truncated`；
- 当前 requestId/turnId；
- 可安全展示的错误信息。

Renderer 只接收经过 Main、Preload 和协议校验的 `started`、`text-delta` 与唯一终态，不保留后端私有错误详情。助手正文与折叠思考按 GFM Markdown 展示并支持 KaTeX 数学公式；用户输入、工具参数与命令提示保持纯文本，原始 HTML 与远程图片都不进入展示。

Composer 支持 Enter 提交、Shift+Enter 换行和 IME composing 保护；消息列表在用户位于底部附近时自动跟随，用户上移后保留阅读位置。滚动区在左右对称保留滚动条槽位，消息列与输入框保持相同水平中心。

## 5. 验收证据

- 前端 TypeScript 检查和 Electron production build 通过；
- Mock Host 覆盖启动失败、业务失败、截断、挂起、崩溃、超时和取消；
- Electron QA 覆盖中文 IME、长回答、窄屏、滚动、停止和焦点；
- 真实 Qwen 完成 SSE、RPC、IPC 和 React 的流式闭环；
- Host 日志只走 stderr，Renderer 不接触 API Key。

## 6. 当前未完成与边界

- 暂无重连和断线后的自动恢复；
- 暂无多窗口/多会话并发；
- 暂无 Markdown 语法高亮、Mermaid 与远程图片，公式缓存与冻结尾部优化未实施；
- 暂无学习地图画布、Node 内容面板和 Main Agent UI；
- 真实模型入口仍依赖 Host 环境变量或本机配置，不在 Renderer 提供凭据设置。

## 7. 进度维护规则

完成一个前端 Step 时：

1. 更新 `frontend-plan.md` 的状态和验收标准；
2. 在本文补充用户可见能力和跨进程链路；
3. 交互/视觉细节保留在 F1/F2 devlog，稳定架构结论才回填本文；
4. 修改 Preload、IPC 或 RPC 时，同时更新安全边界和失败状态；
5. 任何真实桌面能力都必须有 Mock QA 和 Electron 实机/脚本验收，不以浏览器 build 替代。

## 源码目录整理

已按 [目录整理方案](23-structure.md) 完成单词文件命名、子模块目录归位与测试／脚本引用迁移，详见 [实施记录](24-structure.md)。RPC 传输实现位于 `rpc/stream/`，桌面共享契约位于 `frontend/shared/`；本次结构重构未推进后续功能步骤。
