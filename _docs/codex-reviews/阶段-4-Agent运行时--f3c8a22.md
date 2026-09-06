# Git Commit f3c8a22：feat: complete phase 4 agent runtime｜阶段 4：Agent 运行时与执行循环

# 🟠 Medium（警告）

## [可靠性] 同一会话的并发 Turn 会互相污染模型上下文
**状态：** ✅ 已在当前工作树解决（按 `sessionId` 引入最小 Actor/Inbox；同一 Session 由单一 Driver 串行执行，不同 Session 仍可并发；已补充隔离测试，尚未提交）

位置：src/agent/runtime.ts:30
**问题：** runTurn 没有按 sessionId 串行化或拒绝并发执行。第一个 Turn 等待模型时，第二个 Turn 会继续向同一 Session 追加用户消息；第二次请求会看到第一个尚未完成的消息，而任一 Turn 的后续 Step 还可能读到另一个 Turn 的 assistant/tool 结果。
**影响：** 用户重复提交、并发节点或多个调用方共享 Session 时，模型会基于交错且不完整的对话生成结果，工具调用也可能归因到错误的请求。
**建议：** 为每个 sessionId 增加互斥队列，或在已有 Turn 运行时明确拒绝新的 runTurn；同时增加两个并发 Turn 的隔离测试。

## [Bug] 截断响应中的工具调用会留下无法配对的历史记录
**状态：** ✅ 已在当前工作树解决（Assembler 丢弃未闭合或被内容过滤的工具调用；已闭合的 `max-tokens` 工具调用补充未执行错误结果；已补充回归测试，尚未提交）

位置：src/agent/response.ts:29
**问题：** assistant message 会先被写入 Surface，随后 max-tokens 或 content-filter 直接返回 blocked，导致其中可能存在的 tool-call 块既不执行，也没有对应的 tool-result。模型在生成工具参数期间被截断时即可触发。
**影响：** 后续 Turn 会把悬空的工具调用重新发送给 Provider；OpenAI 兼容接口通常会拒绝未紧随工具结果的 assistant tool_calls，使该 Session 后续请求持续失败。
**建议：** 阻塞前为每个已持久化的工具调用补充明确的错误 tool-result，或不要将这些不完整的工具调用加入模型可见 Surface。

## [可靠性] 收到终止块后仍继续等待流结束
**状态：** ✅ 已在当前工作树解决（收到首个 `finish` 后立即结束收集，并通过异步迭代器清理路径关闭底层流；已有清理测试覆盖，尚未提交）

位置：src/llm/collect.ts:24
**问题：** finish 是流协议的终止信号，但 collectStream 记录它后仍继续迭代。若 Adapter 已发出有效 finish 却未及时关闭迭代器，Runtime 会一直等待到模型 Deadline。
**影响：** 已经完成的响应会被误判为超时并触发重试，造成数分钟延迟、重复请求和额外模型费用。
**建议：** 收到首个 finish 后立即结束迭代，并让 for-await 的清理流程关闭底层迭代器。

# 🟡 Low（建议）

## [契约一致性] Runtime 失败原因没有写入已定义的错误事件
**状态：** ✅ 已在当前工作树解决（LLM、Tool 与 Runtime 失败均写入结构化 `error` 事件，并保留终止事件顺序；已补充回归测试，尚未提交）

位置：src/agent/runtime.ts:99
**问题：** 模型永久失败、重试耗尽、运行时异常和 Step 上限仅体现在返回值中；Session 只记录 status，不记录 failure，且本次新增 Runtime 从未追加协议中已有的 error 事件。
**影响：** 事件监听器或之后检查 Session 日志的代码只能知道 Turn 失败或阻塞，无法恢复具体原因，破坏日志作为审计和重放事实源的既有约定。
**建议：** 在失败或阻塞终止前追加对应的 error 事件，包含 turnId、可用时的 stepId、source 和同一 Failure；保留现有 step-ended/turn-ended 顺序。
