# 阶段 3 LLM 与工具能力接口开发记录

## 阶段范围

本阶段完成计划 Step 3.1～3.8，以及为修正职责边界新增的 Step 3.6.1：

- Provider-neutral、stream-only 的 LLM Service；
- 流式 Mock LLM Adapter；
- Harness 风格 StreamChunk 协议；
- Tool 注册、Schema 校验、顺序执行和错误结果；
- echo、失败、延迟测试工具；
- LLM 与 Tool 的错误、取消、卸载和资源清理测试；
- Plugin 职责拆分与手写代码文件 300 行约束。

## 做了什么

### LLM 协议与 Service

- 在 `src/llm/types.ts` 建立 `block-start → delta → block-end → usage → finish` 流协议，可表达 text、reasoning、多工具调用、usage 和终止原因。
- `block-end` 只允许模型可生成的 text、reasoning、tool-call；tool-result 不允许从模型流中产生。
- `LLMAdapter` 和 `ctx.llm` 只保留 `stream()`，彻底删除迁移期 `generate()` / `GenerateResponse`。
- `LLMService` 按 provider 路由 Adapter，对每次 `iterator.next()` 做 Abort 竞速，并将 Adapter 创建、迭代和 IteratorResult getter 异常归一化为终止 finish。
- 正常 consumer close 会等待 `iterator.return()`；Abort 路径触发并观察清理，但不让不协作 iterator 阻塞调用方。
- Adapter 注册返回幂等 disposer；已开始的流固定使用捕获的 Adapter，后续路由替换只影响新请求。
- `LLMServiceError`、错误码和类型守卫独立到 `src/llm/errors.ts`。

### Mock LLM Adapter

- `MockLLMAdapter` 使用队列脚本，支持 `chunks`、`error`、`handler`、`hang` 四类行为。
- 支持部分 chunk 后报错/挂起、逐 chunk 延迟、请求快照和同一 signal 的协作取消。
- 调用一旦被 Adapter 接受即消费脚本项，中途取消不放回队列。
- timer 与 abort listener 在完成和取消路径都清理；输出 chunk 和请求 payload 使用快照避免测试外部修改。

### Tool 协议、Schema 与 Service

- `ctx.tools` 提供 Tool 注册/撤销、Schema 查询、单调用执行和顺序批处理。
- Tool 模块按职责拆为 `types.ts`、`errors.ts`、`schema.ts`、`service.ts`：公共协议和可序列化 Failure 与可抛出 Error 分离。
- 模型 arguments 保持原始 JSON 字符串进入 Tool 边界，在执行前解析并按受支持 JSON Schema 子集递归校验。
- 当前 Schema 支持 object、array、基础类型、required、properties、additionalProperties 和 enum；注册时拒绝未知关键字，避免模型声明与运行时执行不一致。
- 未知 Tool、非法参数、业务异常、非法输出和取消统一产生保留原 `ToolCallId` 的错误 `ToolResultContentBlock` 与结构化 `ToolFailure`。
- Tool Definition、Schema、参数、输出和结果均经过快照/冻结；已开始调用固定使用捕获的 Definition。
- 顺序批处理中业务失败不阻止后续调用；取消后未启动调用直接补齐 cancelled result，保证每个已接收调用都有结果。
- Tool body 接收调用方的同一 signal；已启动工作等待协作收敛，不用 Promise race 假装副作用已经停止。

### 测试工具与测试组织

- 显式 `TestTools` Plugin 注册 `test_echo`、固定失败和可取消延迟 Tool，不进入生产默认组合。
- 多 Tool 注册失败时回滚已有注册，Plugin 卸载时逆序撤销；延迟 Tool 清理 timer 和 listener。
- LLM 测试按路由/生命周期、错误边界、取消/cleanup 拆分；Tool 测试按核心边界、取消/顺序执行拆分；共享 Context 和构造函数位于 `tests/helpers/`。
- 验证 Schema 不泄露 execute callback、Schema 快照冻结、错误 callId 关联、timeout signal、timer 清零、真实顺序屏障、失败后继续、取消结果补齐和执行中 Definition 固定。

## 关键决策

- **核心只保留 Stream：** 即使 Provider 只支持完整响应，也由 Adapter 包装成 chunk，不在核心维护双 API。
- **完整工具调用边界：** 只有携带完整 `ToolCallContentBlock` 的 `block-end` 才可进入后续执行。
- **双层取消：** LLM Service 保证上层及时结束等待，Adapter 负责真正停止 Provider I/O；Tool Service 不遗弃已启动的同进程副作用，Tool 必须协作收敛。
- **错误进入领域结果：** LLM Adapter 错误进入 finish；Tool 调用错误进入 tool result。注册冲突和非法 Plugin 定义等配置错误仍同步抛出。
- **不持久化 chunk：** 后续 Agent Step 在内存组装完整或截断 assistant message，Session 只提交最终事实。
- **顺序 Tool：** 当前阶段不引入并发分类和独占屏障，严格按模型顺序执行。
- **模块级 Error：** 公开可抛出错误归属各 Plugin，不建立全局错误仓库；可序列化 Failure/Result 仍属于协议。
- **文件规模：** 手写代码文件不超过 300 行，按职责拆分而不是机械切割。

## 与 DeepSeek Harness 的一致点

- 采用统一 block 生命周期、index 关联和流内终止错误。
- Adapter/Tool 注册返回精确 disposer，已开始调用固定路由。
- 捕获 dispatch、iterator、next、IteratorResult getter 等 Adapter-owned 错误，同时保留 consumer cleanup 错误。
- Tool Schema 是模型可见字段的 allowlist，不暴露执行 callback。
- 未知 Tool、非法参数和 Tool 异常收敛为结果，并保持 callId 权威关联。
- 同进程 Tool 采用协作取消，已启动工作达到 quiescence 后才返回。
- 测试 fixture 与生产 Tool 组合分离。

## 当前保留差异

- SkillWorld finish 使用既有 `cancelled`，Harness LLM 使用 `aborted`。
- 暂无 LLM middleware、prepareCall、retry policy、model catalog 和 replay。
- 暂无 Tool scope/restriction、approval、pre/post policy、PTC、presentation、output schema 和并发调度。
- Tool 当前直接返回字符串或 text blocks，尚未采用 Harness 的 canonical JSON value → output schema → render 管线。
- timeout 由上层组合 AbortSignal；正式模型/工具限制策略留到 Step 4.5。
- Image 等多模态块等真实需求出现后再加入；Audio 优先经 Tool 转写，不提前开放 ContentBlockMap。

## 坑与发现

- `AsyncIterator.return()` 可能被 pending next 阻塞，Abort cleanup 不能无界等待。
- `IteratorResult.done/value` getter 也可能抛错，必须处于 Adapter 错误边界内。
- Service 的及时 Abort 不代表底层 I/O 已停止；signal 必须继续传到 SDK、fetch 或 Tool 拥有的资源。
- JSON Schema 属性名可能与 `Object.prototype` 成员重名，查找必须使用 own-property；对象 enum 比较不能依赖键顺序。
- 多注册 Plugin 初始化失败必须回滚，否则会留下部分能力。
- 顺序执行测试必须使用 gate 证明下一调用尚未启动，不能只根据最终结果数组推断顺序。
- 取消批处理时要为未启动调用补齐 cancelled result，否则后续 Session 会出现孤立 tool call。

## 验证

- `pnpm tsc --noEmit` 通过。
- Vitest：8 个测试文件、55 个测试通过。
- 所有 `src/`、`tests/` 手写 TypeScript 文件均不超过 300 行。
- 源码和测试中不再存在非流式 `generate()` / `GenerateResponse`。

## 下一步

进入 Phase 4 Step 4.1：定义 Agent Runtime 协议，将 Session、流式 LLM 和 Tool 执行边界接入 Step/Turn 生命周期。
