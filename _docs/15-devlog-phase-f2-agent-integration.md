# 阶段 F2：Electron 接入 Agent 与真实流式对话

## 阶段结论与阅读入口

F2 已完成：桌面默认入口通过 Renderer → Preload → Electron Main → Kernel Host → Agent Runtime → Qwen SSE 实现单会话、纯文本、多轮流式对话，支持停止、失败、截断和 Host 异常收敛。

本文合并 F2 规划、F2.1 和 F2.3–F2.7 开发记录，保留实现决策、问题与历史验收证据。F2.2 属于后端交付，原记录保留在 [Backend Kernel Host 与真实模型](17-devlog-step-f2-2-kernel-host.md)。合并文档编号接续 24 号；其他阶段文档保留现有编号。

- 阶段状态与后续步骤以 [前端开发计划](frontend-plan.md) 为准。
- 当前能力与安全边界见 [前端开发进度总览](20-frontend-progress.md)。
- 下文测试数量和 QA 数据均为各步骤完成时的记录，本次文档合并未重新运行代码测试或桌面验收。

## F3 开发承接基线

- 保持跨进程链路及凭据边界；Renderer 不获得原始 RPC、Node API、模型地址或密钥。
- F2 的公共业务流为 `started → text-delta* → completed/cancelled/failed/truncated`；RPC id、requestId、sessionId 与 turnId 各自承担不同关联职责。
- 单活动 Turn、统一取消、首个终态优先、迟到事件隔离和部分正文保留，是后续扩展必须保留的行为。
- F2 桌面工具集合为空，reasoning 不混入正文；后端支持相关能力不代表前端已经展示。
- F3 已规划助手有序内容块、reasoning、工具卡片和独立会话级命令通知，尚未实现。下一步为 F3.1 公共事件契约，冻结后由后端交付事件出口，前端再扩展桥接、状态与界面。
- 多会话、持久化恢复、Markdown、通用 Gateway 和完整回放仍不自动纳入 F3；具体范围遵循前端计划。

## F2 规划与范围收敛

初始规划曾考虑 snapshot、sequence 和恢复语义，最终 F2.1 MVP 明确延期 snapshot、重连与回放；下面规划内容只作为历史决策背景，不能视为已实现契约。

### 做了什么

- 将前端计划中的 F2 从方向占位拆为 F2.R–F2.7，覆盖共享契约、Backend Kernel Host、Electron Main、Preload、Renderer 状态、流式 UI 与桌面验收。
- 明确正式链路为 Renderer → Preload → Main → Kernel Host → Agent Runtime，不采用 Renderer 或 Main 长期直连 Qwen。
- 写明后端交接清单、最小产品范围、实施顺序与阻塞门槛；本次未实现代码，也未修改后端计划。

### 关键决策

- 共享契约先于实现，必须版本化、运行时校验，并定义 snapshot、相关 ID、sequence、终止、错误、取消、兼容和尺寸边界。
- 流式 delta 只负责即时展示，持久事实由 Host 的 Session snapshot/完成事实确认；取消保留部分输出但忽略迟到 delta。
- F2 首版单会话、纯文本、单在途 Turn、工具默认禁用；真实 delta 优先于人为打字延迟。

### 坑与发现

- 当前后端已有 LLM StreamChunk、Agent Runtime 与 Session Event 基础，但没有真实 Qwen Adapter、桌面对外 Host 或前端可消费的实时 Turn 出口。
- Harness 的 baseline-first、相关 ID、取消贯穿、正文/reasoning 分离和缺终止即断流值得采用；其通用 Gateway、Waterfall 和多 Carrier 超出当前范围。
- 跨端契约是共享控制面，必须指定唯一写入者并串行处理；后端 F2.2 应由后端 Agent 自行写入后端计划。

## F2.1 通用 Stream RPC MVP

### 做了什么

- 新增共享 `rpc/` 包，提供版本 1 的 open/item/end/error/cancel 协议、严格运行时校验、StreamRpcClient、StreamRpcServer、StreamRpcRouter 与 NDJSON 增量分帧。
- 新增唯一业务契约 `agent.turn`：输入 sessionId/requestId/text，输出 started、text-delta 及 completed/cancelled/failed/truncated 终态。
- 新增共享 RPC 独立 TypeScript 配置和 8 个协议/生命周期测试；没有修改前后端包清单或锁文件。

### 关键决策

- RPC 核心不依赖 Electron、React、Cordis 或模型；stdio 仅是后续第一个 Transport。
- 第一版只支持请求对应流式响应，不做 unary、snapshot、重连、工具或 reasoning；Agent 流要求 started 开头且恰好一个业务终态。
- 可序列化 RpcFailure 与可抛出 RpcError 分文件；双方校验精确字段、版本、JSON-safe 数据、尺寸与业务输出顺序。

### 坑与发现

- NDJSON 不能假设一个 data chunk 对应一帧，因此覆盖半行、多行及 finish 残留；单帧上限 1,048,576 字符。
- Client 取消后立即结束本地迭代并忽略迟到帧，同时向 Server 发送 cancel；Server 将其转换为 Handler 的 AbortSignal。
- 根项目原有 19 个测试文件共 150 项通过；RPC 独立 2 个测试文件共 8 项通过；所有手写 RPC 文件低于 300 行。

## F2.2 Backend Kernel Host 交付摘要

详细决策、启动配置与验收保留在 [后端原始记录](17-devlog-step-f2-2-kernel-host.md)。

- Host 复用 `createApp()` 和 Agent Runtime，stdin/stdout 使用 NDJSON，诊断日志只走 stderr；桌面默认 `toolNames: []`。
- Qwen Adapter 解析 Chat Completions SSE；正文与 reasoning 分离，正文已发布后遇到断流不重试，避免重复前缀。
- Host 默认输出上限为 8192 token，默认关闭 thinking；模型凭据由 Host 环境提供。
- `max-tokens` 映射为 `truncated`，业务失败与 RPC 传输失败分开处理；stdin EOF 取消活动请求。
- 提供真实 Host 与 Mock Host；当时后端 169 项、共享 RPC 11 项测试及根构建通过。

## F2.3 Main Host 生命周期与传输

### 做了什么

- Electron Main 现在只创建一个 `KernelHostProcess`，启动真实或 Mock Kernel Host，并在应用退出前关闭 RPC 与子进程。
- 新增客户端 stdio NDJSON Transport，直接复用共享 `StreamRpcClient`，向后续 Preload 提供通用流式请求入口。
- 新增 Host 启动配置、就绪检测、stderr 脱敏与大小上限，以及启动失败、崩溃、取消和强制退出保护。
- 增加 3 个测试文件共 9 个测试，并完成 Electron Mock Host 实机启动。

### 关键决策

- Windows 下不直接执行 `pnpm.cmd`；Electron 以 `ELECTRON_RUN_AS_NODE=1` 启动根工程的 `tsx` 和 Host 入口，参数保持数组传递。
- Main 不解释 `AgentTurnEvent`，只按公共 `RpcMethod` 路由流；业务顺序继续由共享 RPC 输出校验器负责。
- 窗口关闭时先结束 Host stdin，让 Server 取消并排空活动请求；超过时限才发送终止信号。

### 坑与发现

- Electron 44 在 Windows 使用 `shell:false` 直接 spawn `.cmd` 会返回 `EINVAL`，且同步 spawn 异常必须转换为 rejected Promise，调用方的 `.catch()` 才能统一处理。
- 命令不存在时 Windows 不保证触发 `exit`；清理等待必须把 `error`、`exit` 和 `close` 收敛成同一个退出事实。
- stderr 可能没有换行且无限增长，因此超限行直接丢弃，避免日志泄密和无界缓冲。
- 参考 `deepseek-harness/packages/core/agent-loop/src/{index,agent}.ts` 的单一 `AbortSignal` 和 dispose 取消语义；当前桌面 MVP 沿用共享 RPC 的 cancel/EOF 传播，未引入 Harness 的 Gateway、Waterfall、多 Carrier 或持久恢复。

## F2.4 Preload 最小安全桥

### 做了什么

- 新增固定的 Agent Turn IPC start、cancel 和 update 通道，Main 不接受 Renderer 自定义 method 或 channel。
- 新增 Main 侧 `AgentTurnController`，管理唯一活动 Turn、Renderer 所有权、取消、迟到更新和安全错误映射。
- Preload 仅向 `window.desktop.agent` 暴露 `startTurn`、`cancelTurn` 和 `onTurnUpdate`，订阅返回 cleanup。
- 新增 Renderer 可见类型与更新解析器，Preload 在投递前再次校验 Agent 事件和桥接错误。

### 关键决策

- Renderer 提供业务 `requestId`，RPC 自己生成并管理协议 `id`，两者不混用。
- Client 取消会立即结束本地 RPC 流，因此 Main 将该控制结果收敛成公开 `cancelled` 业务事件。
- 业务终态一旦发布便优先成立，即使 Host 在随后的 RPC `end` 前退出，也不追加第二个桥接错误。
- 未知异常只暴露固定 `host-unavailable` 信息，避免进程路径、堆栈或凭据进入 Renderer。

### 坑与发现

- IPC 调用者必须和活动 Turn 的 `ownerId` 一致才能取消，窗口销毁也会取消其请求。
- 订阅必须移除注册时的同一个函数引用，否则 React 卸载后会继续收到事件。
- 参考 `deepseek-harness/packages/core/agent-loop/src/{index,agent}.ts` 的单一取消信号、首个终态收敛和迟到输出隔离；当前桥接只支持一个固定 `agent.turn`，未采用 Gateway、Waterfall、多 Carrier、重连或回放。

## F2.5 Renderer 对话状态内核

### 做了什么

- 新增纯函数 `conversationReducer`，管理用户消息、助手占位、活动 Turn、正文 delta 和所有业务终态。
- 新增 `useAgentConversation`，负责固定本地会话、请求 ID、Bridge 订阅、开始、取消和卸载清理。
- 按当前 `requestId` 过滤迟到更新，同时只允许一个活动 Turn。
- 增加状态机测试，当前前端共 7 个测试文件、27 项测试通过。

### 关键决策

- 一次提交原子加入用户消息与空助手消息，避免首个 delta 到达前没有稳定渲染目标。
- `started` 记录 Host `turnId`，首个 `text-delta` 将助手状态切为 `streaming`。
- `completed`、`cancelled`、`failed` 和 `truncated` 都清除活动 Turn，并保留已经生成的正文。
- Bridge 或 start/cancel 命令失败只影响当前请求；聊天状态仅保留稳定 `code/message`，不保存扩展 details。

### 坑与发现

- React render 尚未提交时也可能连续触发发送，因此 Hook 使用同步 ref 执行互斥，reducer 再维护可渲染的活动状态。
- 取消命令可能和自然终态竞争；只有 ref 仍指向同一请求时才允许命令失败覆盖状态。
- 参考 `deepseek-harness/packages/core/agent-loop/src/{index,agent}.ts` 的单活动执行、统一取消、流式前缀保留和迟到输出隔离；当前 Renderer 内核只管理本地单会话文本，不采用队列、回放、持久化或多会话调度。

## F2.6 流式对话界面

### 做了什么

- `ChatWorkspace` 已接入 `useAgentConversation`，真实消息、活动状态、发送和取消替代 F1 本地消息数组。
- 新增 `MessageList`，展示用户气泡、助手正文、等待、流式光标、取消、失败和截断状态。
- `Composer` 在生成期间切换为停止按钮，同时保留草稿编辑、Enter 发送、Shift+Enter 换行和输入法组合态保护。
- 新增完整 Electron QA 入口，覆盖 Main、Preload、Renderer、RPC、Mock Host 和真实 Qwen Host。

### 关键决策

- 正文直接显示真实 delta，不增加人为逐字定时器；React 只合并同一绘制帧内的更新，不延迟完成语义。
- 用户位于底部 80px 范围内才自动跟随；主动滚离后，长回复不会强制改变阅读位置。
- 助手正文继续使用 React 文本节点和 `white-space: pre-wrap`，不解析 Markdown 或 HTML。
- 流式光标和等待点遵循 `prefers-reduced-motion`，终态立即移除动效。

### 坑与发现

- Vitest 原配置只发现 `.spec.ts`，必须显式加入 `.spec.tsx` 才会执行组件渲染测试。
- 隐藏 Electron 窗口会节流绘制并产生过期截图，QA 改为可见窗口后再捕获桌面与窄屏画面。
- QA 入口从 `out/main` 直接启动时需要显式设置仓库根目录，避免 Host 的 `tsx` 路径多偏一层。
- 参考 `deepseek-harness/packages/core/agent-loop/src/{index,agent}.ts` 的流式前缀保留、取消收敛和终态优先；UI 没有引入人工打字队列、Markdown、工具调用展示或多会话。

### 验证结果

- 9 个测试文件、32 项测试通过，TypeScript 与 Electron build 通过。
- Mock 全链路在 140ms 时显示 200/2220 字符、停止保留 160 字符，完成正文完整；桌面和 560px 窄屏无横向溢出。
- 滚到顶部后，后续 2220 字符回复保持 `scrollTop=0`；真实 Qwen 全链路成功返回 8 字正文并正常完成。

## F2.7 错误与桌面验收

### 做了什么

- Main 的 start IPC 改为返回受校验的 `accepted/rejected` 结果，Preload 转为 `DesktopAgentCommandError`，Renderer 不再把所有拒绝压成“无法启动 Agent 请求”。
- 区分 `turn-in-progress`、`bridge-closed`、`invalid-input`、`host-unavailable`、`connection-closed` 和 `turn-timeout`。
- `AgentTurnController` 增加 120 秒活动 Turn 超时，超时优先于取消收敛为明确的桥接错误。
- 扩展 Electron QA，覆盖 failed、truncated、crash、hang→timeout、Host 启动失败、中文 IME、长回答、停止、滚动保护和真实 Qwen。

### 关键决策

- IPC 命令拒绝是正常业务结果，不通过 Electron reject 传递未结构化 Error；Main、Preload 和 Renderer 都校验同一个稳定结果对象。
- 超时只由 Main 的活动 Turn 计时器产生，触发后 Abort 同一请求信号，避免 Renderer 另起不一致的计时器。
- 已经发布业务终态后，后续 transport 错误或 delta 都被忽略，保留首个终态与可见正文。

### 坑与发现

- “无法启动 Agent 请求”表示 IPC invoke 被拒绝，发生在 Qwen 前；真实模型链路应显示 Host/transport 失败或业务失败。
- 真实 Qwen 验收在新回执格式下仍返回 8 字正文；Model 与 Host 已经接通。
- 窗口关闭会取消同一 owner 的 Turn；Host 进程清理由 F2.3 生命周期管理器负责。
- 参考 `deepseek-harness/packages/core/agent-loop/src/{index,agent}.ts` 的统一取消、超时优先、流式前缀保留和终态收敛；本阶段没有实现断线恢复、重放、队列或多会话调度。

### 验证结果

- 前端 9 个测试文件、38 项测试通过，TypeScript 与 Electron build 通过。
- Electron Mock QA 验证 Host 启动失败、业务失败、截断、断流、超时、取消、终态后 delta、窗口关闭取消、中文 IME、长回答和滚动保护。
- 真实 Qwen 经 SSE→RPC→IPC→React 成功完成，结果写入 `frontend/qa-output/f2-6-real-results.json`。
