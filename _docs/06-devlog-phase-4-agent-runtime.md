# 阶段 4 Agent Runtime 开发记录

## 阶段结果

阶段 4 完成了从一次用户输入到最终模型回答的最小 AgentLoop：Runtime 驱动 Turn 与 Step，Session 保存不可变事件和模型可见 Surface，LLM 提供流式响应，Tools 执行模型请求的工具调用。循环支持多 Step、有限模型重试、超时、取消和稳定终止。

```text
user message
  -> model stream
  -> assistant tool calls
  -> ordered tool results
  -> next model request
  -> final assistant answer
```

## 模块划分

- `agent/runtime.ts`：Cordis Service、Turn 循环和 Step 循环。
- `agent/request.ts`：构造模型请求、记录请求快照、执行一次 Deadline 约束的模型尝试。
- `agent/response.ts`：接纳 assistant message、解释阻塞原因、执行并记录工具结果。
- `agent/result.ts`：构造 Step outcome、Turn result、工具结果消息和 Runtime failure。
- `agent/limits.ts`：限制校验、Deadline、瞬时错误分类、有限重试和可取消退避。
- `agent/types.ts`：公开 Turn 协议及内部共享的 TurnScope、ModelCompletion。
- `llm/collect.ts`：只将 StreamChunk 归并为完整内容、usage 和 finish，不依赖 Agent 或 Session。
- `session/store.ts`：不可变事件日志、模型 Surface、增量派生缓存和 replace 基础。

Runtime 最终保持为 109 行，只保留执行编排；模型请求、响应接纳和结果构造均有单独职责边界。

## Turn 与 Step 语义

- Turn 是一次外部请求的生命周期，终态为 `completed`、`blocked`、`cancelled` 或 `failed`。
- Step 是一次模型请求及其工具处理阶段，状态为 `completed`、`continue`、`cancelled` 或 `failed`。
- 没有工具调用时，Step 和 Turn 自然完成。
- 有工具调用时，工具结果写入 Surface，Step 返回 `continue`，Runtime 启动下一 Step。
- `max-tokens` 与 `content-filter` 表示模型请求已结束，因此 Step 为 `completed`，但 Turn 为 `blocked`。
- 每个已启动 Step 恰好写入一个 `step-ended`；每个 Turn 恰好写入一个 `turn-ended`。

## Session Surface

Session 对外提供 `deriveMessages(sessionId, systemPrompt?)`，Runtime 不再自己读取全量事件并维护消息缓存。

- 原始事件日志保持只追加。
- 普通消息事件通过 Surface append 增量进入模型窗口。
- Surface replace 可以用摘要节点替换一段可见节点，原始日志仍然保留。
- replace 后下一次派生重建缓存；普通 append 只派生新增节点。
- system prompt 是请求前缀，不写入 Session Surface；完整请求由 `llm-requested` 保存快照。

当前只实现压缩所需的 Surface 基础，没有实现自动摘要、来源引用、持久化恢复和工具配对修复。

## 模型流与重试

Runtime 仍然直接发起 `ctx.llm.stream(request)`；`llm/collect.ts` 只负责协议归并，不创建 MessageId，也不判断 Agent 状态。

- 每次模型尝试都有独立 Deadline，默认 300 秒。
- 默认最多额外重试 5 次。
- 可重试错误与 Harness 默认一致：`EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT`；同时兼容当前 Service 的 `stream-failed`。
- 退避从 500ms 指数增长到 10s，并使用 10% 抖动。
- 有效且不超过 10s 的 Provider `retryAfterMs` 优先。
- 重试发生在同一个开放 Step，失败尝试的部分输出不会写入 assistant message。
- 外部取消优先于超时和重试；Deadline、退避监听器和计时器都会被清理。

Harness 通过 Provider 策略与独立 `llm-retry` 插件持久记录重试；当前最小实现将策略集中在 Agent 模块，重复的 `llm-requested` 事件表示多次尝试，尚无专门 retry 事件。

## Step 上限与工具边界

- 默认 `maxSteps` 为 150，调用方可以按 Turn 覆盖。
- 达到上限后不再创建新 Step，Turn 返回 `blocked/max-steps-exceeded`。
- Runtime 不自动重试工具，避免盲目重放有副作用的操作。
- 工具时限不由 Runtime 统一猜测；需要模型选择时限的工具应在自己的参数 Schema 中声明，并由工具实现执行。
- 当前工具调用顺序执行。并行安全工具并发、独占屏障和按模型顺序提交结果仍是明确遗留点。

## 真实接口验证

`scripts/real.ts` 提供显式真实模型测试，默认连接 `http://192.168.99.2:8090/v1`，可通过 `LLM_BASE_URL`、`LLM_MODEL` 和 `LLM_API_KEY` 覆盖。脚本要求模型调用一次本地 echo 工具，再输出 `FINAL: real-loop`，已验证真实两 Step Turn 闭环。该脚本不进入默认测试，避免普通回归依赖网络和模型资源。

## Harness 对照

保持一致的原则：

- AgentLoop 消费模型流并解释工具调用。
- 每个被接纳的事实先写入 Session，再进入下一 Step。
- 模型请求失败可在同一 Step 内恢复。
- 取消优先于重试，生命周期边界必须平衡。
- 工具取消后保留可恢复的 call/result 事实。

当前差异：

- 没有 Inbox、steering、follow-up 和 Agent idle/running 状态机。
- 不持久化原始 chunk，因此取消时不保存已展示的流式前缀。
- 没有 retry 专用事件和 Provider 级可组合重试插件。
- 没有并行工具调度、Session 持久化恢复和自动压缩。
- Harness 没有内置 Turn Step 上限；本项目按产品安全边界默认限制为 150。
- Harness 的 300 秒对应流空闲 watchdog；当前项目限制整次模型尝试。

## 验证结果

- `pnpm typecheck` 通过。
- 12 个测试文件、81 项测试全部通过。
- 覆盖直接回答、两 Step 闭环、多工具顺序、工具错误、请求窗口、重试成功与耗尽、永久错误、超时、取消、工具取消、Step 上限和阻塞终止。
- 验证失败尝试不污染 Session Surface、取消不触发后续请求、所有计时器清理、Turn/Step 日志完整闭合。
- `src/`、`tests/` 与 `scripts/` 使用单个职责词文件名；全部手写 TypeScript 文件不超过 300 行。

## 下一步

进入阶段 5.1，装配 Session、LLM、Tools 与 AgentRuntime 的最小应用入口。
