# F2.7 错误与桌面验收

## 做了什么

- Main 的 start IPC 改为返回受校验的 `accepted/rejected` 结果，Preload 转为 `DesktopAgentCommandError`，Renderer 不再把所有拒绝压成“无法启动 Agent 请求”。
- 区分 `turn-in-progress`、`bridge-closed`、`invalid-input`、`host-unavailable`、`connection-closed` 和 `turn-timeout`。
- `AgentTurnController` 增加 120 秒活动 Turn 超时，超时优先于取消收敛为明确的桥接错误。
- 扩展 Electron QA，覆盖 failed、truncated、crash、hang→timeout、Host 启动失败、中文 IME、长回答、停止、滚动保护和真实 Qwen。

## 关键决策

- IPC 命令拒绝是正常业务结果，不通过 Electron reject 传递未结构化 Error；Main、Preload 和 Renderer 都校验同一个稳定结果对象。
- 超时只由 Main 的活动 Turn 计时器产生，触发后 Abort 同一请求信号，避免 Renderer 另起不一致的计时器。
- 已经发布业务终态后，后续 transport 错误或 delta 都被忽略，保留首个终态与可见正文。

## 坑与发现

- “无法启动 Agent 请求”表示 IPC invoke 被拒绝，发生在 Qwen 前；真实模型链路应显示 Host/transport 失败或业务失败。
- 真实 Qwen 验收在新回执格式下仍返回 8 字正文；Model 与 Host 已经接通。
- 窗口关闭会取消同一 owner 的 Turn；Host 进程清理由 F2.3 生命周期管理器负责。
- 参考 `deepseek-harness/packages/core/agent-loop/src/{index,agent}.ts` 的统一取消、超时优先、流式前缀保留和终态收敛；本阶段没有实现断线恢复、重放、队列或多会话调度。

## 验证结果

- 前端 9 个测试文件、38 项测试通过，TypeScript 与 Electron build 通过。
- Electron Mock QA 验证 Host 启动失败、业务失败、截断、断流、超时、取消、终态后 delta、窗口关闭取消、中文 IME、长回答和滚动保护。
- 真实 Qwen 经 SSE→RPC→IPC→React 成功完成，结果写入 `frontend/qa-output/f2-6-real-results.json`。

## 下一步

F2 已完成。后续按产品优先级另行规划会话恢复、多会话、Markdown、安全工具调用或 DAG 工作区。
