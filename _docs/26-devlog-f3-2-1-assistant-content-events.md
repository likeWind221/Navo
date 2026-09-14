# F3.2.1：助手内容事件接通与链路收敛

## 做了什么

- 将 Adapter 的实时输出统一为 `ModelEvent`：正文、reasoning 与工具调用共用 `content-started/content-delta/content-completed` 生命周期，并以 Step 内 `contentIndex` 关联交错片段。
- 新增唯一 `StepAccumulator`，由 `collectStream` 在一处把同一 `ModelEvent` 分给实时回调和完整内容聚合；删除旧 `BlockAssembler` 及 Agent/Host 的重复内容组装状态。
- 将 `AgentTurnObserver` 的多方法回调替换为单一 `onEvent(TurnEvent)`。`AgentRuntime` 负责 Turn/Step 开始与结束，模型内容事件只补充 `turnId/stepId/messageId` 后实时转发。
- `agent.turn` v1 继续只投影正文 delta 与原终态；`agent.turn.v2` 直接消费 `TurnEvent`，补充 RPC scope、字符预算和传输队列，不重建完整消息。
- 将公共 RPC 的 `AssistantEvent`、`BlockEvent`、`block-*`、`blockId` 统一为 `TurnEvent`、`ContentEvent`、`content-*`、`contentIndex`；`contentIndex` 可在不同 Step 复用。RPC 不再定义独立 Step 上限。
- v2 暂不发布 tool-call 内容；工具线上生命周期仍由 F3.2.2 实现。stdio 坏 JSON、非法 RPC 外层帧和超长行可在换行后恢复，非法 UTF-8 仍关闭连接。
- 将 Host v2 字符预算测试拆到 `tests/host/turn/v2/limits.spec.ts`，使主生命周期测试保持单一职责并覆盖工具 Step 后 `contentIndex` 从 0 复用。

## 关键决策

- 实时与完整内容只在 `collectStream` 分叉一次：`StepAccumulator` 先校验并累积事件，再调用实时消费者，避免无效模型事件先泄漏到线上；Session 仍只持久化完整 `Message`，不新增片段日志。
- `ContentBlock` 只表示模型可生成的 text/reasoning/tool-call；`MessageContent` 才额外包含 `tool-result`，从类型上阻止模型流生成工具结果。
- `messageId` 在 Step 开始时生成，实时事件与最终持久化消息使用同一 ID。每个 Step 在进入下一 Step 前发布 `step-completed`，因此下一个 Step 可安全重用 provider 的 `contentIndex`。
- 模型失败只有在实时消费者尚未公开内容时才能在同一 Step 内重试；`onEvent` 返回 `false` 可声明事件被有意保留在进程内，因此 v1 隐藏的 reasoning 不阻止重试。公开任何内容生命周期后，失败收敛为 `stream-output-interrupted`，避免同一 Step 重复 `contentIndex` 而线上无法区分 attempt。
- 展示预算不伪造业务终态：Host 在 Unicode 安全位置截断超限 delta，单内容满额后仍允许后续内容。RPC 的 65,536 总事件预算统计 Turn、Step、Content、Tool 全部业务事件，Host 为已打开 Content、当前 Step 和 Turn 终态预留闭合槽位；若下一个 Step 已无法完整表达，`onEvent` 在模型请求前中止该 Step，最终输出 `resource-limit-exceeded`。`turn-truncated` 仍只对应 Runtime 的 `max-tokens` 结果，业务 `maxSteps` 只由 `AgentRuntime` 所有。
- Session 先提交 `turn-ended`，再发布实时 `turn-finished`；收到公共终态的消费者随后读取 Session 时不会观察到未闭合 Turn。

## Harness 对照

- 参考 `deepseek-harness/packages/core/agent-loop/src/agent.ts:339-435`：采用“一个 Step 内消费模型流、由单一 assembler 生成完整 assistant message、模型请求可在 Step 内重试”的职责划分。
- 参考 `deepseek-harness/packages/llm/llm/src/assembler.ts:37-178`：采用按 index 聚合交错片段、截断时不保留不安全工具调用的机制。
- 本项目没有照搬 Harness 的 `assistant/chunk` 持久化、回放 metadata、delta-only 容错和 interrupted message；当前 PRD 只要求完整 Message 持久化，因此 `StepAccumulator` 对缺少 started、类型变化、重复完成等错误严格失败。

## 坑与发现

- Qwen 请求序列化读取的是 `MessageContent[]`，不能把文本提取 helper 限定成 `ContentBlock[]`；tool-result 消息也需要被正常筛选其中的 text 内容。
- tool-call 的名称可能随 delta 增量产生，不能由 `content-started` 假设完整名称。F3.2.1 在 Host 输出前整体过滤 tool-call，避免发出无法满足现有 RPC 工具字段的半条生命周期。
- Qwen 极少数首片段缺少 tool-call ID 的情况不能等待后续 ID，否则多个调用会重排并形成无界缓冲；Adapter 首次出现即生成全局唯一 fallback ID，后续真实 ID 只校验自身稳定性，不改写已发布 ID。
- `contentIndex` 只在 Step 内唯一；RPC 校验器必须在 `step-completed` 后清空活动内容映射，但 Turn 级内容总数和 `toolCallId` 唯一性继续累计。
- 超时原先在 `publishedContent` 判断前直接返回可重试 `TIMEOUT`，会让同一 Step 再次发布从 0 开始的 `contentIndex`；现在超时、Provider error 和断流共用失败收敛，公开后统一变成不可重试的 `stream-output-interrupted`，外部取消仍优先。
- `error/cancelled` 终态原先会强行组装未完成 tool-call，使“缺少名称”的 `TypeError` 覆盖真实错误；现在这些终态丢弃所有工具半成品，只保留安全的 text/reasoning 前缀和原始 finish reason。
- 只统计 Content/Tool 事件会让恶意空 Step 无限扩张身份集合；总事件预算现覆盖全部业务事件，但不重新引入与 Runtime 冲突的 Step 数上限。
- `StreamEventQueue` 仍未实现生产者背压，但总事件与字符预算限制了单 Turn 产出；队列消费由数组 `shift()` 改为游标，避免上限规模下的 O(n²) 搬移。

## 验证

- `pnpm typecheck` 通过。
- `pnpm test`：32 个文件、229 项通过。
- `pnpm exec tsc --noEmit -p rpc/tsconfig.json` 通过；`pnpm exec vitest run --config rpc/vitest.config.ts`：6 个文件、42 项通过。
- `frontend` 下 `pnpm typecheck && pnpm test`：9 个文件、38 项通过；未修改 `frontend/**`。
- `git diff --check` 无空白错误，仅报告仓库现有的 LF/CRLF 转换提示。
- 未运行真实 Qwen API 或 Electron 实机；桌面尚未接入 v2，tool-call/tool-result 线上展示也尚未实现。

## 下一步

- F3.2.2：接通工具开始与结果事件，并确定模型增量工具名到公共 `content-started` 完整工具名之间的映射时机。
- F3.2.3：实现会话命令流与 `/hello` 命令。
- F3.2.4：补齐 Mock 场景与跨端交接验收。
