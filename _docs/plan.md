# SkillWorld 开发计划

## 1. 当前范围

当前只实现 SkillWorld 的**内层 AgentLoop**：给定一次输入、模型和一组工具，在有界、可取消、可重建的条件下执行：

```text
模型请求 → 工具调用 → 工具结果 → 再次请求模型 → 最终响应
```

本阶段不实现 Goal、DAG、Research、Planning、Node 调度、Evidence 和 Verification。后续 Node 执行器只把 AgentLoop 当作通用运行能力使用，DAG 领域类型不得进入内层循环。

## 2. 开发方式

- 严格执行“一个 Step → 人工审查 → 确认后继续”。
- 每个 Step 开始前先说明目标、目标文件、改动内容和完成标准。
- 未经确认，不提前创建或修改后续 Step 的文件。
- 每个 Step 原则上只处理一个主要实现文件；测试文件作为独立 Step。
- 完成计划行时，按项目约定同步更新状态、开发记录和文档索引。
- DeepSeek Harness 仅作为只读参考，不修改 `deepseek-harness/`。

## 3. 状态说明

- ⬜ 未开始
- 🔄 进行中
- ✅ 已完成
- ⛔ 阻塞

## 阶段 0：TypeScript 与 Cordis 工程骨架

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | 0.1 项目清单 | `package.json` | 声明 ESM、Node 版本、TypeScript、Vitest、tsx 和上游 `cordis` 依赖及最小脚本；不依赖 `@deepseek-ai/cordis` | 清单可审查；依赖使用精确版本；不引入 Agent/DAG 业务依赖 |
| ✅ | 0.2 TypeScript 配置 | `tsconfig.json` | 开启 strict、Node ESM、声明源码与测试编译范围 | `tsc --noEmit` 能读取配置；禁止隐式宽松类型 |
| ✅ | 0.3 安装依赖 | `pnpm-lock.yaml` | 使用约定的 pnpm 版本安装依赖并生成锁文件 | 安装成功；依赖版本被锁定；不修改参考源码 |
| ✅ | 0.4 最小入口 | `src/index.ts` | 创建空的 Cordis Context 启动与释放入口，为后续 Service 组合预留位置 | 入口可运行并正常退出；暂不注册 Agent 能力 |

## 阶段 1：提供商无关核心协议

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | 1.1 品牌化 ID | `src/brand/ids.ts` | 定义 Session、Message、Event、ToolCall 等品牌化 ID 及构造函数 | 不同 ID 在 TypeScript 中不可互换；运行时仍可序列化为字符串 |
| ✅ | 1.2 消息协议 | `src/llm/types.ts` | 定义 Message、text/reasoning/tool-call/tool-result 内容块、ToolSchema、FinishReason、TokenUsage 和 LLM 请求响应 | 不依赖具体 Provider；reasoning 可记录但不参与循环判断；tool call/result 可关联 |
| ✅ | 1.3 协议编译期断言 | `tests/llm-types.typecheck.ts` | 用类型断言验证品牌化 ID、内容块关联和响应类型边界 | 类型检查通过；错误 ID 混用、缺失 error failure 均有编译期证据 |
| ✅ | 1.4 协议运行时样例 | `tests/llm-types.spec.ts` | 用运行时样例验证 ID 构造、消息协议与 JSON 序列化 | JSON 数据可稳定构造；空 ID 被拒绝；品牌化 ID 运行时仍为字符串 |

## 阶段 2：SessionLog 与上下文投影

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | 2.1 会话事件协议 | `src/session/types.ts` | 定义 turn/step、user/assistant、request、tool call/result、error 事件及事件信封 | 事件由 type 判别；包含 session、sequence、timestamp；事件数据可序列化 |
| ✅ | 2.2 Session Store | `src/session/store.ts` | 定义 Cordis `ctx.sessions` Service、仅追加接口和内存实现 | sequence 严格递增；提交后不可变；先提交再发布事件 |
| ✅ | 2.3 Message Projector | `src/session/projector.ts` | 从事件日志投影模型 messages | 只投影 user、非空 assistant 和 tool result；相同前缀产生相同结果 |
| ✅ | 2.4 会话日志测试 | `tests/session-store.spec.ts` | 验证追加、顺序、不可变性和 Cordis 生命周期 | 注册、使用、释放均通过；监听器只看到已提交事实 |
| ✅ | 2.5 投影测试 | `tests/message-projector.spec.ts` | 验证模型可见与非可见事件边界 | 边界事件不进入 messages；工具结果顺序稳定；可从完整日志重建 |

## 阶段 3：LLM 与工具能力接口

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | 3.1 LLM Service | `src/llm/service.ts` | 定义 Cordis `ctx.llm`、Adapter 注册、路由和 generate 接口 | AgentLoop 不依赖 Provider SDK；支持 AbortSignal；注册可随插件卸载撤销 |
| ✅ | 3.2 Mock LLM Adapter | `src/llm/mock-adapter.ts` | 提供按队列返回响应的测试 Adapter | 可记录请求并确定性返回文本、reasoning 或工具调用 |
| ✅ | 3.3 流式 LLM 协议 | `src/llm/types.ts` | 参考 Harness 增加 block-start/delta/block-end/usage/finish 流协议；暂保留旧完整响应类型作为迁移桥 | Chunk 可表达文本、reasoning、多工具调用、usage 和终止原因；不持久化 chunk；现有代码仍可编译 |
| ✅ | 3.4 LLM 流式边界重构 | `src/llm/service.ts`、`src/llm/mock-adapter.ts` | 将 Service 与 Mock Adapter 原子切换为 stream-only；实现逐次迭代取消、错误终止和部分输出脚本 | 公共调用不再提供 generate；Adapter 接收同一 signal；Mock 可输出部分 chunk 后挂起/取消；无 timer/listener 残留 |
| ✅ | 3.5 流式 LLM 测试与旧协议清理 | `tests/llm-service.spec.ts`、`tests/llm-types.*`、`src/llm/types.ts` | 验证流注册、路由、块顺序、错误、卸载和调用中取消，并移除迁移期完整响应类型 | 流式边界具有稳定分类；旧 generate/GenerateResponse 不再存在；生命周期无残留注册 |
| ✅ | 3.6 Tool Service | `src/tools/service.ts` | 定义 Cordis `ctx.tools`、工具注册、Schema 查询、参数校验与顺序执行 | 未知工具、参数错误和业务异常都规范化为错误 tool result；注册可撤销 |
| ✅ | 3.6.1 Plugin 职责与文件规模修正 | `src/tools/{types,errors,schema,service}.ts`、`src/llm/errors.ts`、`tests/llm-service*.spec.ts`、`CLAUDE.md` | 拆分 Tool 协议/错误/Schema/执行和 LLM 错误，按行为拆分超长测试，建立手写代码 300 行限制与模块级 errors 约定 | 所有手写代码文件不超过 300 行；公开可抛出错误归属模块 errors.ts；行为和测试语义不变 |
| ✅ | 3.7 测试工具插件 | `src/tools/test-tools.ts` | 提供 echo、失败和延迟工具用于闭环测试 | 工具行为确定、支持取消，不进入生产默认组合 |
| ✅ | 3.8 Tool Service 测试 | `tests/tool-service.spec.ts` | 验证成功、未知工具、非法参数、异常、超时/取消和卸载 | 每个已接收调用都产生规范结果；错误不会破坏 callId 关联 |

## 阶段 4：Agent 步骤与轮次循环

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ⬜ | 4.1 Agent Runtime 协议 | `src/agent/types.ts` | 定义 RunTurnInput、TurnResult、限制配置和状态类型 | API 不含 DAG 领域类型；终态明确区分 completed、blocked、cancelled、failed |
| ⬜ | 4.2 单 Step 执行器 | `src/agent/step.ts` | 记录请求快照，调用 LLM，提交 assistant message，顺序执行工具并提交 call/result | 无工具时 completed；有工具时 continue；step/end 在所有路径恰好一次 |
| ⬜ | 4.3 单 Step 测试 | `tests/agent-step.spec.ts` | 验证直接回答、单工具、多工具、工具错误和请求失败 | 事件顺序正确；工具调用与结果完整配对；失败无重复终止事件 |
| ⬜ | 4.4 Turn Loop Service | `src/agent/runtime.ts` | 定义 Cordis `ctx.agentRuntime`，追加 turn 边界并循环执行 Step | 工具结果进入下一次请求；自然完成时停止；turn/end 恰好一次 |
| ⬜ | 4.5 终止保护 | `src/agent/limits.ts` | 实现最大 Step、模型超时、工具超时、有限模型重试与统一取消辅助 | 取消优先于重试；副作用工具不由循环盲目重试；超限返回稳定状态 |
| ⬜ | 4.6 Turn Loop 测试 | `tests/agent-runtime.spec.ts` | 验证多步闭环、最大步数、模型重试、超时、取消和异常收敛 | 所有退出路径日志闭合；Agent 调用结束后无后台任务残留 |

## 阶段 5：最小 Node 接入证明与验收

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ⬜ | 5.1 最小组合入口 | `src/app.ts` | 组合 Session、LLM、Tools 和 AgentRuntime 插件 | Cordis 依赖自动激活；应用释放时所有 Service 和注册项正常撤销 |
| ⬜ | 5.2 闭环集成测试 | `tests/agent-loop.integration.spec.ts` | 模拟“用户输入 → 模型调用工具 → 工具返回 → 模型最终回答” | 精确验证两次模型请求及完整事件序列；上下文可由日志重建 |
| ⬜ | 5.3 Node 调用边界 | `src/node/node-agent.ts` | 定义最小 NodeAgent 适配器，将节点描述转换为一次 AgentRuntime 调用 | 仅证明 Node 可以调用内层循环；不实现 DAG、节点调度、证据或验证 |
| ⬜ | 5.4 最小闭环验收 | `tests/node-agent.integration.spec.ts` | 验证一个 Node 通过 AgentLoop 使用工具并返回结果 | Node 层不绕过 AgentRuntime；内层事件完整；领域状态未泄漏进 AgentLoop |

## 4. 本轮非目标

以下能力不进入当前计划：

- DAG 创建、版本化和调度；
- Research、Planner、Executor、Verifier 角色；
- Evidence、Verdict 和 GoalController；
- 并行工具和独占屏障；
- 流式 chunk 全量持久化；
- 上下文压缩、surface replacement 和投影增量缓存；
- Inbox、steering、inject 和 Session fork；
- 子 Agent、多 Profile、Web UI 和远程 RPC；
- Thought 文本解析或以自然语言思维链驱动状态机。

## 5. 当前下一步

当前等待执行：**步骤 4.1 Agent Runtime 协议**。

执行前按四段式流程从架构功能层面说明 Turn/Step 输入输出、限制配置、终态分类和与 Session/LLM/Tools 的依赖边界；设计前先只读检查 Harness Agent Loop 对应协议，并明确当前方案与 Harness 的差异。
