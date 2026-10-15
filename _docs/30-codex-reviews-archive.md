# 30：Codex 提交审查归档

历史 post-commit 审查钩子（`.githooks/`）对阶段 2–7、F3、F4 提交生成的 Codex 审查报告。钩子已移除，后续不再生成新报告；原 `codex-reviews/` 目录的 10 份报告按提交时间合并于此，内容未改写。各条“状态”为报告生成时的状态，后续处理以对应阶段开发记录与 Git 历史为准。

## Git Commit 499849d：feat: add session log and message projection｜阶段 2：SessionLog 与上下文投影

## 🟠 Medium（警告）

### [可靠性] 事件监听器异常会让已成功提交的 append 表现为失败
**状态：** ✅ 已在当前工作树解决（提交后的 `session/event` 改为隔离通知；同步抛错与异步拒绝不再改变 `append` 结果，也不会阻断其他观察者；已补充回归测试，尚未提交）

位置：src/session/store.ts:48
**问题：** 事件已写入 events 数组后才同步调用 ctx.emit；Cordis 的 emit 会直接传播监听器抛出的异常。因此任一 session/event 监听器抛错时，append 会向调用方抛出异常，但事件实际上已经提交。
**影响：** 调用方按失败重试会写入重复事件；若放弃重试，又可能误判日志未落地，形成无法可靠判断提交结果的状态。
**建议：** 隔离通知阶段的监听器异常，例如捕获并记录异常而不改变 append 的成功结果，或将发布改为具有明确错误语义的独立异步操作；补充监听器抛错后 append 结果和日志内容的测试。

### [Bug] EventId 在不同 SessionStore 实例间会重复
**状态：** ✅ 已在当前工作树解决（改用 `crypto.randomUUID()` 并补充跨实例唯一性测试，尚未提交）

位置：src/session/store.ts:38
**问题：** EventId 仅由实例内从零开始的 eventCount 生成。创建两个 Context、释放并重新注册服务或进程重启后，都会再次生成 event-1、event-2 等相同标识。
**影响：** 订阅 session/event 的审计或持久化消费者若以 EventId 去重或作为主键，会把不同事件误判为同一事件，造成覆盖、漏记或错误关联。
**建议：** 使用 crypto.randomUUID() 等跨实例唯一标识生成 EventId；至少应加入多 Context 或服务重建后 ID 不冲突的测试。

## Git Commit 5b699c6：fix: use globally unique session event ids｜阶段 2：SessionLog 与上下文投影

未在 PATH 中找到 Codex CLI，无法执行审查。

## Git Commit d64d35e：feat: add streaming llm and tool services｜阶段 3：LLM 与工具调用接口

## 🟠 Medium（警告）

### [可靠性] 取消竞态会把已经成功完成的副作用工具报告为未完成
**状态：** ✅ 已在当前工作树解决（成功结果不再被后到的 Abort 覆盖，并补充竞态与顺序执行测试，尚未提交）

位置：src/tools/service.ts:103
**问题：** 工具完成后再次检查 `signal.aborted`，并无条件丢弃成功输出。若工具已经提交副作用后信号才被取消（例如工具同步提交操作并触发取消，或取消恰好发生在 Promise 兑现后的微任务间隙），这里会返回 `cancelled`，与真实执行状态不一致。
**影响：** 调用方可能认为操作未执行并重试，导致重复付款、重复发送消息等数据完整性问题，同时成功结果也无法写入会话。
**建议：** 工具 Promise 成功兑现后保留并返回成功结果；只在调用前已取消，或工具因传入的信号实际拒绝时返回 `cancelled`。若必须记录迟到的取消，应作为独立元数据保留，不能覆盖已提交的结果。

### [Bug] 仅凭 AbortError 名称会把普通工具故障误判为用户取消
**状态：** ✅ 已在当前工作树解决（仅以本次调用的 `signal.aborted` 判定取消，并补充无关 AbortError 测试，尚未提交）

位置：src/tools/service.ts:106
**问题：** 捕获分支在调用信号未取消时，仍将任何名为 `AbortError` 的异常归类为 `cancelled`。工具内部的 fetch 超时、独立 AbortController 或底层库中止都可能产生同名异常，但并不代表本次工具调用被上层取消。
**影响：** 真实工具故障会丢失并被报告成取消；后续运行时可能直接终止而不执行错误处理或重试，且诊断信息被隐藏。
**建议：** 仅在传入的 `signal.aborted` 为真时归类为取消；其他 `AbortError` 按 `tool-failed` 处理，或要求工具抛出携带本次调用信号身份的专用取消错误。

### [Bug] Provider 内部 AbortError 被错误转换为调用方取消
**状态：** ✅ 已在当前工作树解决（仅以请求自己的 `signal.aborted` 判定取消，并补充 Provider AbortError 测试，尚未提交）

位置：src/llm/service.ts:208
**问题：** `failureChunk` 在请求信号未取消时也把任意 `AbortError` 转为 `{ kind: "cancelled" }`。Provider SDK 因内部超时、连接中止或自身控制器而抛出的 `AbortError` 因此无法与用户取消区分。
**影响：** 可恢复的 Provider 故障会成为取消终态，导致 Agent 跳过失败处理或重试，并向上层返回错误的结束原因。
**建议：** 取消分类应以本次请求的 `signal.aborted` 或服务自身创建的可识别取消错误为准；没有对应信号证据的 `AbortError` 应规范化为 `stream-failed`。

### [安全] 工具异常原文被直接写入模型可见结果
**状态：** ✅ 已在当前工作树解决（内部诊断与模型消息分离，未知异常默认隐藏原文，工具可显式提供安全的 `modelMessage`，尚未提交）

位置：src/tools/service.ts:197
**问题：** 任意工具异常的 `error.message` 会进入 `ToolFailure`，随后未经清理拼入模型可见的 `ToolResultContentBlock`。数据库、HTTP SDK 和命令执行错误经常包含文件路径、连接串、请求参数、令牌或内部服务信息。
**影响：** 下一轮调用外部模型时可能把本地敏感信息或基础设施细节发送给第三方 Provider，造成隐私和凭据泄露。
**建议：** 模型可见 block 使用稳定的通用错误文案或经过允许列表清理的消息；详细异常仅保留在内部诊断字段或受控日志中。

## 🟡 Low（建议）

### [Bug] 超出安全整数范围的参数会在校验前被静默改值
**状态：** ✅ 已在当前工作树解决（integer 改用 `Number.isSafeInteger`，并补充安全边界与超界测试，尚未提交）

位置：src/tools/schema.ts:223
**问题：** `JSON.parse` 会把超过 JavaScript 安全整数范围的 JSON 整数舍入，而这里使用 `Number.isInteger` 仍会判定其有效。例如 `9007199254740993` 会变成 `9007199254740992` 后传给工具。
**影响：** 当整数用于订单号、账户号或其他精确标识时，工具可能针对错误对象执行操作。
**建议：** 对 `integer` 使用 `Number.isSafeInteger`；需要支持更大精确整数的字段应要求以字符串传递并在工具内部显式解析。

## Git Commit f3c8a22：feat: complete phase 4 agent runtime｜阶段 4：Agent 运行时与执行循环

## 🟠 Medium（警告）

### [可靠性] 同一会话的并发 Turn 会互相污染模型上下文
**状态：** ✅ 已在当前工作树解决（按 `sessionId` 引入最小 Actor/Inbox；同一 Session 由单一 Driver 串行执行，不同 Session 仍可并发；已补充隔离测试，尚未提交）

位置：src/agent/runtime.ts:30
**问题：** runTurn 没有按 sessionId 串行化或拒绝并发执行。第一个 Turn 等待模型时，第二个 Turn 会继续向同一 Session 追加用户消息；第二次请求会看到第一个尚未完成的消息，而任一 Turn 的后续 Step 还可能读到另一个 Turn 的 assistant/tool 结果。
**影响：** 用户重复提交、并发节点或多个调用方共享 Session 时，模型会基于交错且不完整的对话生成结果，工具调用也可能归因到错误的请求。
**建议：** 为每个 sessionId 增加互斥队列，或在已有 Turn 运行时明确拒绝新的 runTurn；同时增加两个并发 Turn 的隔离测试。

### [Bug] 截断响应中的工具调用会留下无法配对的历史记录
**状态：** ✅ 已在当前工作树解决（Assembler 丢弃未闭合或被内容过滤的工具调用；已闭合的 `max-tokens` 工具调用补充未执行错误结果；已补充回归测试，尚未提交）

位置：src/agent/response.ts:29
**问题：** assistant message 会先被写入 Surface，随后 max-tokens 或 content-filter 直接返回 blocked，导致其中可能存在的 tool-call 块既不执行，也没有对应的 tool-result。模型在生成工具参数期间被截断时即可触发。
**影响：** 后续 Turn 会把悬空的工具调用重新发送给 Provider；OpenAI 兼容接口通常会拒绝未紧随工具结果的 assistant tool_calls，使该 Session 后续请求持续失败。
**建议：** 阻塞前为每个已持久化的工具调用补充明确的错误 tool-result，或不要将这些不完整的工具调用加入模型可见 Surface。

### [可靠性] 收到终止块后仍继续等待流结束
**状态：** ✅ 已在当前工作树解决（收到首个 `finish` 后立即结束收集，并通过异步迭代器清理路径关闭底层流；已有清理测试覆盖，尚未提交）

位置：src/llm/collect.ts:24
**问题：** finish 是流协议的终止信号，但 collectStream 记录它后仍继续迭代。若 Adapter 已发出有效 finish 却未及时关闭迭代器，Runtime 会一直等待到模型 Deadline。
**影响：** 已经完成的响应会被误判为超时并触发重试，造成数分钟延迟、重复请求和额外模型费用。
**建议：** 收到首个 finish 后立即结束迭代，并让 for-await 的清理流程关闭底层迭代器。

## 🟡 Low（建议）

### [契约一致性] Runtime 失败原因没有写入已定义的错误事件
**状态：** ✅ 已在当前工作树解决（LLM、Tool 与 Runtime 失败均写入结构化 `error` 事件，并保留终止事件顺序；已补充回归测试，尚未提交）

位置：src/agent/runtime.ts:99
**问题：** 模型永久失败、重试耗尽、运行时异常和 Step 上限仅体现在返回值中；Session 只记录 status，不记录 failure，且本次新增 Runtime 从未追加协议中已有的 error 事件。
**影响：** 事件监听器或之后检查 Session 日志的代码只能知道 Turn 失败或阻塞，无法恢复具体原因，破坏日志作为审计和重放事实源的既有约定。
**建议：** 在失败或阻塞终止前追加对应的 error 事件，包含 turnId、可用时的 stepId、source 和同一 Failure；保留现有 step-ended/turn-ended 顺序。

## Git Commit e5cef39：feat: finalize session agent loop｜阶段 5：最小 Node 集成验证与本轮验收

## 🟠 Medium（警告）

### [可靠性] 排队中的 Turn 无法及时响应取消
位置：src/agent/inbox.ts:49
**问题：** Turn 入队后没有监听 input.signal；只有轮到该 envelope 并执行 handle() 时，runtime 才会检查取消状态。触发条件是同一 Session 已有长时间运行或不收敛的 Turn，随后提交的 Turn 在排队期间被取消。
**影响：** 被取消 Turn 的 Promise 仍会一直等待前一个 Turn 结束；若前一个 Turn 永久挂起，取消请求也永久不返回，违反 RunTurnInput 对整个 Turn 的可取消契约。
**建议：** 入队时订阅 AbortSignal，并在尚未开始执行时将 envelope 从队列移除并立即收敛为 cancelled；开始执行或离队时移除监听器，同时保持所需的生命周期记录语义。

### [契约一致性] 无迁移说明地删除了 ToolService.executeSequential 公共 API
位置：src/tools/service.ts:120
**问题：** 本次提交删除了此前公开且已有测试覆盖的 executeSequential()，同时删掉相关测试，但阶段 3 开发记录仍明确声明 Tool Service 支持顺序批处理及取消后补齐结果。现有调用方继续调用该方法时会直接编译失败或在 JavaScript 中得到“不是函数”。
**影响：** 依赖既有 ToolService 契约的调用方发生行为回归，并失去统一保证调用顺序、失败后继续以及取消结果配对的入口。
**建议：** 恢复 executeSequential() 作为兼容包装；若确需移除，应先更新公开契约并提供迁移入口及弃用周期。

## 🟡 Low（建议）

### [契约一致性] LLMAdapter 从原导入路径消失
位置：src/llm/service.ts:14
**问题：** LLMAdapter 被移动到 adapter.ts 后仅在 service.ts 中导入，没有继续导出；此前从 llm/service.js 导入该公开类型的适配器实现会编译失败。
**影响：** 现有 Provider Adapter 代码需要无预警修改导入路径，与本次收口提交未声明破坏性接口变更不一致。
**建议：** 在 service.ts 增加 `export type { LLMAdapter } from "./adapter.js"` 保留兼容路径，或明确发布破坏性迁移说明。

## Git Commit 7cbe687：feat: add node workflows, search, RPC, and desktop UI｜阶段 6：Node 教材与练习内容 MVP

## 🟠 Medium（警告）

### [可靠性] 取消可能先于 open 帧送达，遗留无法取消的服务端任务
位置：rpc/stream-rpc.ts:90
**问题：** Abort 回调会立即并发发送 cancel，但此时第 100 行的 open 发送可能仍未完成。对于不保证并发 send 调用顺序的异步 Transport，cancel 可以先到达服务端并被忽略，随后 open 才启动 Handler；客户端已经删除该流，不会再次取消它。
**影响：** 用户在连接繁忙或具有发送缓冲的真实 stdio/IPC Transport 上停止生成后，后端任务仍可能继续消耗模型额度和计算资源，且其后续输出全部被客户端丢弃。
**建议：** 记录 open 发送 Promise，并让取消帧在 open 成功提交后串行发送；若 open 失败则只结束本地队列。也可以在 Transport 契约中实现并强制验证每连接发送串行化。

### [可靠性] 服务端未等待分离的请求任务，关闭后可能继续发送并产生未处理拒绝
位置：rpc/stream-rpc.ts:179
**问题：** 每个 run() 都以 void 启动且没有保存 Promise。serve() 结束或 dispose() 被调用时仅中止控制器并立即清空 active、关闭 Transport；仍在退出的 Handler 随后会在第 210 行向已关闭的 Transport 发送 end。若该发送失败，异常发生在 catch 块内部，不会再次被捕获，而分离 Promise 也无人观察。
**影响：** Host 退出、窗口关闭或传输断开时可能出现未处理的 Promise rejection；关闭操作返回后业务 Handler 仍在运行，破坏生命周期收口并可能导致进程崩溃或资源泄漏。
**建议：** 维护活动 run Promise 集合；关闭时先标记服务端已关闭并 abort，等待所有任务 settle 后再完成释放，同时在关闭状态下禁止发送，或显式吞掉预期的连接关闭错误。

### [性能] 客户端响应队列无上限，可被快速流耗尽内存
位置：rpc/stream-rpc.ts:224
**问题：** consume() 会持续读取 Transport，并将消费者来不及处理的每个 item 推入 AsyncQueue.values；该数组没有项目数或字节数上限，也没有反压。单帧虽然限制为约一百万字符，但帧数量不受限制。
**影响：** 生成端异常、恶意或只是明显快于 Renderer 消费时，单个响应流即可持续堆积大对象并最终导致 Electron Renderer/客户端内存耗尽。
**建议：** 为每个流设置明确的缓冲项目数或字符预算；达到上限时暂停底层读取（若 Transport 支持反压），否则取消该请求并以稳定的 overflow 错误结束流。

## 🟡 Low（建议）

### [可靠性] NDJSON 解码会静默接受并替换非法 UTF-8
位置：rpc/ndjson.ts:6
**问题：** TextDecoder 使用默认的非 fatal 模式。Transport 收到非法 UTF-8 字节时，解码器会插入 U+FFFD；如果损坏字节位于 JSON 字符串中，JSON.parse 仍会成功，校验层会把被篡改的文本当作合法帧。
**影响：** 会话文本、请求 ID或方法参数可能在跨进程传输中被静默损坏，且双方无法区分真实的替换字符与编码错误。
**建议：** 使用 new TextDecoder("utf-8", { fatal: true })，并把 decode/finish 抛出的编码异常转换为 code 为 invalid-frame 的 RpcError。

## Git Commit 294d624（feat: complete fetch and desktop agent integration）— 阶段 7：Fetch 网页读取与调研闭环补强

未发现需要修改或改进的问题。

## Git Commit ed88fc6（refactor: reorganize source modules and naming rules）— 阶段 F3：助手内容展示与会话级命令反馈

未发现需要修改或改进的问题。

## Git Commit d09d384（feat: add chat process fold and icon library for F4）— 阶段 F4：Agent 过程展示（思考 / 工具 / 通知）

### 🟠 Medium（警告）

#### [Bug] 生成中点击过程行标题会让回合结束后永久失去自动折叠
位置：frontend/src/workspace/chat/process/Row.tsx:24
**问题：** `onClick` 无条件翻转 `userExpanded`，而 `expanded = !folded || userExpanded`（第 14 行）让生成期间的这次点击没有任何可见效果；但它已经把 `userExpanded` 置为 true，回合结束后 `folded` 变为 true，该行因此保持展开。开发记录写的是“等待与生成阶段点击标题不会收起内容，只有回合结束后用户才能折叠与展开”，实现与此不符。
**影响：** 用户在生成中随手点一下标题（按钮此刻 `aria-expanded=true`，看起来可切换），回合结束时过程就不会按 F4.2 的核心行为折叠成“已处理 Ns”一行，必须再点一次才收起。`qa/process.cjs` 在生成中连点两次恰好抵消了这个副作用，因此单元测试与桌面验收都无法发现。
**建议：** 让生成期间的点击无副作用，例如 `disabled={!folded}` 或 `onClick={() => { if (folded) setUserExpanded((current) => !current); }}`；同时把 `qa/process.cjs` 中生成中的点击改为只点一次，再断言回合结束后仍然折叠。

### 🟡 Low（建议）

#### [Bug] 流式判定由内容块状态退化为行/消息状态，异常结束时流式光标不复位
位置：frontend/src/workspace/chat/process/Row.tsx:31
**问题：** 折叠前传给 `AssistantBlock` 的 `live` 是 `!folded`，而改造前是 `active && block.status === "streaming"`（`List.tsx` 的 `isTurnLive(message.status)` 现在只用在最终回答上）。当回合在未补发 `content-completed` 的情况下进入终态（Host 崩溃或连接断开触发的 `turn-error`/`bridge-error`；`src/agent/output.ts` 的 `finish()` 正常路径会先补发），`final === null` 因而不折叠，仍在 `streaming` 的思考块会一直显示“思考中”与闪烁光标。对称的瞬时问题是 Host 先发最后一块文本的 `content-completed`、再发 `turn-completed`，中间那次渲染把已完成正文档当作流式内容（`List.tsx:79` 的 `streaming={live}`），F3.11 的公式语法短暂回退为 `$x$` 字面量。
**影响：** 思考中途回合异常结束时，过程行里的思考块永久停留在“思考中”并持续闪烁，属于 F3.4/F3.6 已验收行为的回归；完成瞬间最终回答的公式会先以字面量渲染再切换。
**建议：** 把回合活性而不是折叠结果透传给内容块：`ProcessRow` 增加 `live` 参数并传 `live={isTurnLive(message.status)}`，块内继续用 `live && block.status === "streaming"` 判定；最终回答改为 `streaming={live && content.final.status === "streaming"}`。

#### [测试缺口] 桌面验收记录了横向溢出却从未断言
位置：frontend/scripts/qa/process.cjs:144
**问题：** 快照收集了 `overflow`（第 59 行：`article.scrollWidth > article.clientWidth`），但整个脚本没有任何断言使用它，也没有像 `icons.cjs` 那样做窄窗口复测。F4.2 的完成标准明确要求“Electron 验收确认折叠体不可见、展开后可读且无横向溢出”，`frontend-plan.md` 据此把 F4.2 标为 ✅。
**影响：** 长工具参数或长通知把助手消息撑出横向溢出时 `pnpm --dir frontend qa:process` 依然通过，验收标准中唯一没有自动断言的一项会静默失效。
**建议：** 在现有断言后补 `assert.equal(streaming.overflow, false)`、`assert.equal(folded.overflow, false)`、`assert.equal(expanded.overflow, false)`，并仿照 `icons.cjs` 在 `window.setSize(560, 720)` 后重新取快照断言。

#### [契约一致性] 本次新增的 5 篇 F4 文档没有登记进文档索引
位置：_docs/index.md:62
**问题：** 提交新增 `_docs/49-devlog-chatgpt-codex-ui-research.md`、`_docs/50-process-ui-design.md`、`_docs/51-devlog-f4-1-icons.md`、`_docs/53-devlog-icon-library-research.md`、`_docs/55-devlog-f4-2-process-fold.md`，但 `_docs/index.md` 的“前端记录”段落仍止于第 62 行的 F3.11，索引中查不到任何 F4 条目。
**影响：** 项目约定要求每完成一个步骤同时完成“写开发记录 + 在 index.md 登记 + 更新计划状态”，缺一即视为该步骤未完成；当前计划把 F4.1/F4.2 标为 ✅，但只读索引的人找不到 F4 的调研、实施方案与开发记录。
**建议：** 在 `_docs/index.md` 的“前端记录”段落补齐这 5 行（F4.1、F4.2 开发记录，F4 过程 UI 实施方案，两份调研），与 `frontend-plan.md` 的 F4 状态对应。

#### [契约一致性] “当前下一步”在同一计划文档内自相矛盾
位置：_docs/frontend-plan.md:205
**问题：** 本次提交在第 199 行新增“当前推进 F4.3 流式过程标题与用时 … F4.3–F4.4 未开始”，同时把第 205 行的旧句改写为“F3 之后的前端阶段已由 F4 承接，当前下一步为 F4.1”，而同一提交已把 F4.1、F4.2 标为 ✅。
**影响：** 计划是后续 Step 执行的单一事实源，同文档两处冲突会让接手者误判当前应执行 F4.1 还是 F4.3，也影响后续步骤状态的核对。
**建议：** 把第 205 行改为与第 199 行一致的表述（例如“前端阶段当前为 F4，下一步 F4.3”），或删除这句已被上层段落取代的话。

## Git Commit 3b0e2da（feat(frontend): 完成 F4 过程展示并归档验收记录）— 阶段 F4：Agent 过程展示（思考 / 工具 / 通知）

### 🟠 Medium（警告）

#### [Bug] 工具图标查找会误取原型属性并导致渲染崩溃
位置：frontend/src/workspace/chat/process/tool.ts:23
**问题：** 当工具名为 `constructor` 或 `__proto__` 时，`icons[name]` 会返回普通对象继承的函数或原型对象，因而不会触发 `?? "tool"`。该值传入 Icon 后，无法取得有效的 Shape，导致 React 渲染异常。公共事件校验允许这些工具名，工具注册也没有禁止；模型产生此类未知工具调用时同样可能触发。
**影响：** 本应显示为通用工具行或未知工具失败的事件会使消息组件渲染崩溃，阻断当前会话展示。
**建议：** 仅在 `Object.hasOwn(icons, name)` 为真时取映射值，否则使用 `"tool"`；补充 `constructor` 和 `__proto__` 的映射及渲染回归测试。
