# 前端开发进度总览

**基线提交：** `294d624`  
**范围：** Electron Main、Preload、Renderer、Kernel Host 接入和桌面验收。

## 1. 当前结论

前端已经完成 F0–F2.7：从静态工作区推进到真实 Qwen Agent 的流式桌面对话。默认入口通过安全 Preload Bridge 调用 Main，由 Main 管理独立 Kernel Host；Renderer 不接触原始 RPC method、Provider 凭据或后端 Cordis Context。

F2 阶段已完成，但恢复/重连、多会话、Markdown、工具调用可视化和长期历史仍是后续功能，不在当前默认能力中。

F3.1 已完成共享契约与两端校验：新增 `agent.turn.v2` 的有序内容块及 `session.command.v1` 的独立通知流；尚未注册真实 Host Handler 或接入桌面 UI。取消停止等待不等于后端操作撤销，后续桥接需要保留结果未知状态。详见 [F3.1 开发记录](23-devlog-step-f3-1-public-events.md)。

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
| F3.1 | ✅ | 助手内容、独立命令通知、身份绑定与顺序校验 | `rpc/content/stream.ts`、`rpc/command.ts` |

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

Renderer 只接收经过 Main、Preload 和协议校验的 `started`、`text-delta` 与唯一终态，不渲染 Markdown/HTML，不保留后端私有错误详情。

Composer 支持 Enter 提交、Shift+Enter 换行和 IME composing 保护；消息列表在用户位于底部附近时自动跟随，用户上移后保留阅读位置。

## 5. 验收证据

- 前端 TypeScript 检查和 Electron production build 通过；
- Mock Host 覆盖启动失败、业务失败、截断、挂起、崩溃、超时和取消；
- Electron QA 覆盖中文 IME、长回答、窄屏、滚动、停止和焦点；
- 真实 Qwen 完成 SSE、RPC、IPC 和 React 的流式闭环；
- Host 日志只走 stderr，Renderer 不接触 API Key。

## 6. 当前未完成与边界

- 暂无重连和断线后的自动恢复；
- 暂无多窗口/多会话并发；
- 暂无 Markdown 渲染和工具调用可视化；
- 暂无长期对话历史和持久化会话列表；
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

已按 [目录整理方案](24-structure.md) 完成单词文件命名、子模块目录归位与测试／脚本引用迁移，详见 [实施记录](25-structure.md)。RPC 传输实现位于 `rpc/stream/`，桌面共享契约位于 `frontend/shared/`；本次结构重构未推进后续功能步骤。
