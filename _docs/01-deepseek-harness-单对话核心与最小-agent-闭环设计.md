# DeepSeek Harness 单对话核心与 SkillWorld 最小 Agent 闭环设计

**日期：** 2026-08-29
**范围：** 基于项目内 `deepseek-harness/` 源码快照进行阅读；本文只做调研与设计，不包含代码实现。

## 1. 结论先行

DeepSeek Harness 的核心并不是一个很长的 `while` 循环，而是下面四项约束共同组成的运行系统：

1. **Session 事件日志是事实源**：用户消息、模型回复、工具结果和运行边界都先写入日志。
2. **模型上下文由日志投影得到**：不单独维护一份容易失真的可变 `messages`。
3. **Agent 只负责实时驱动**：处理输入、步骤、模型请求、工具调用、终止、重试和取消。
4. **能力通过插件接入**：LLM、工具、持久化、重试、上下文压缩等都在明确的扩展点上工作，尽量不修改主循环。

对 SkillWorld 最值得借鉴的不是完整插件框架，而是：**事实先落盘、上下文可重建、循环保持精简、领域能力放在循环外。**

## 2. 技术栈与整体架构

### 2.1 技术栈

| 项目 | DeepSeek Harness 采用的方案 |
|---|---|
| 语言 | TypeScript，严格类型检查 |
| 运行时 | Node.js `^22.19 || >=24` |
| 模块系统 | ESM |
| 工程组织 | pnpm workspace monorepo |
| 插件运行时 | Cordis：Context、Service、Effect、事件与 waterfall 中间件 |
| 构建 | `tsc` 输出库和类型，`tsdown` 打包运行入口 |
| 测试 | Vitest；单元、覆盖率、E2E、会话快照测试 |
| Schema | Zod、Schemastery、JSON Schema |
| LLM 接入 | Provider-neutral LLM 接口；DeepSeek 实现调用兼容 `/chat/completions` 的流式接口 |
| 流式协议 | HTTP + SSE，使用 `eventsource-parser` 解析 |
| 远程 API | Typert 类型图与 RPC 基础设施 |

### 2.2 分层

```text
宿主/Profile
  └─ Cordis 插件组合与生命周期
      ├─ 核心能力定义：Session / Agent / LLM / Tools / Prompt
      ├─ Agent Loop：单会话编排
      ├─ Provider：DeepSeek、工具、持久化等实现
      └─ Consumer：CLI、Web、工作流、子 Agent 等使用者
```

每项完整能力通常分为三种角色：

- **Service Definition**：定义接口、事件和数据类型；
- **Service Provider**：提供具体实现；
- **Consumer**：只依赖抽象能力，不直接依赖 Provider。

## 3. 单对话核心逻辑

### 3.1 两类对象

- **Session**：持久事实，保存追加式事件日志，并从日志派生模型可见消息。
- **Agent**：实时执行器，拥有 Inbox、运行状态和取消信号；进程退出后可由 Session 恢复。

这一区分很重要：Session 回答“发生过什么”，Agent 回答“现在由谁继续执行”。

### 3.2 主流程

```text
用户输入
  → 写入持久 Inbox
  → 唤醒 Agent driver
  → turn/start
  → 领取输入并组装 system prompt、运行上下文和工具 Schema
  → agent/pre-step
  → step/start
  → 写入 user/message
  → 从 Session 日志投影模型历史
  → 构造并冻结本次 LLM 请求
  → 流式接收并记录 assistant/chunk
  → 写入 assistant/message
  → 无工具调用：step/end → turn/end
  → 有工具调用：
       写入 tool/call
       → 执行工具
       → 按模型调用顺序写入 tool/result
       → 进入下一 step，再次请求模型
```

其中：

- **turn** 表示处理一次用户目标或连续输入的完整回合；
- **step** 表示一次模型请求以及它产生的工具处理；
- 工具结果会成为下一次模型请求的历史，因此工具调用仍属于同一 turn。

### 3.3 关键事件

DeepSeek Harness 的事件种类很多，理解核心只需关注：

```text
turn/start
step/start
user/message
request/header
assistant/chunk
assistant/message
tool/call
tool/result
step/end
turn/end
```

只有 `user/message`、非空 `assistant/message` 和 `tool/result` 会直接投影为模型消息；边界、流片段和诊断事件仍保留在日志中，但不占用模型上下文。

### 3.4 请求与工具

每次请求不仅记录消息，还记录当时的：

- provider 和 model；
- 模型配置与 Adapter 默认值；
- 完整 system prompt；
- 有序的工具 Schema；
- 上下文窗口等路由信息。

因此可以解释或重放“模型当时究竟看到了什么”。

工具调度允许并行安全工具重叠执行，独占工具形成屏障；但是结果无论实际完成先后，都按模型发出的调用顺序写入日志。这样既有并发效率，又保持模型历史稳定。

## 4. 值得借鉴的设计亮点

### 4.1 模型可见即已记录

任何会影响模型的内容都必须能从 Session 日志重建，禁止只存在于内存中的隐藏上下文。这可以显著降低恢复、调试和重放难度。

### 4.2 先提交事实，再通知观察者

Session 追加事件时，先校验并提交，再通知监听器。监听器看到的是已经成立的事实，不能让持久状态与外部观察结果产生半提交状态。

### 4.3 原始日志与模型投影分离

日志不删除历史；上下文压缩通过“替换模型表面的一段投影”完成，并记录来源和代次。这样可以同时保留：

- 完整审计历史；
- 当前紧凑上下文；
- 压缩内容的来源关系。

### 4.4 实时并发，持久结果有序

工具可以并行执行，但进入模型上下文的结果顺序固定。这条原则也适合 SkillWorld：节点可以并发运行，图版本、验证结论和证据提交必须有确定顺序。

### 4.5 请求准备时冻结依赖

模型调用前固定 Adapter、模型、默认参数和路由，避免热更新恰好发生在请求期间，造成“按旧能力生成、由新实现发送”的混合状态。

### 4.6 取消是收敛过程

取消不只是调用 `abort()`：还要停止派发新工作、等待已启动工作收尾、记录未执行工具的取消结果，最后才回到 idle。取消优先于重试。

### 4.7 主循环小，行为从扩展点进入

重试、持久化、上下文压缩、审批、标题生成等都不是硬编码进主循环。这降低了循环分支数量，也使每项能力能够单独测试和替换。

## 5. 不应直接照搬的部分

DeepSeek Harness 面向完整产品和多种运行环境，第一版 SkillWorld 不需要立即实现：

- Cordis 级全插件框架与动态热替换；
- 工具并行、独占屏障和运行时重新分类；
- 流式 chunk 全量持久化；
- 上下文原子替换、来源追踪和复杂压缩；
- 多 Profile、远程 RPC、Web UI 和双 SDK 投影；
- 子 Agent、工作流、PTC、审批和权限体系；
- Adapter 注册代次与动态 Provider 目录。

这些机制很优秀，但提前实现会掩盖 SkillWorld 当前最重要的目标：先跑通可验证的 DAG 闭环。

## 6. SkillWorld 的最小 Agent 闭环

### 6.1 两层循环

SkillWorld 需要明确区分两个循环：

```text
内层：单对话 Agent Loop
  模型请求 → 工具调用 → 工具结果 → 再请求 → 回合结束

外层：DAG Goal Loop
  调研 → 规划 → 执行节点 → 验证 → 通过或再规划 → 目标结束
```

**内层循环是通用运行基础设施，外层循环才包含 SkillWorld 的 DAG 规则。** 不应把规划、验证或图修改逻辑写死在 `AgentLoop` 中。

### 6.2 最小组件

```text
AgentLoop
  ├─ Inbox                 接收用户输入或系统续跑指令
  ├─ ConversationLog       追加式会话事件
  ├─ SurfaceProjector      从事件生成模型 messages
  ├─ LLMAdapter            屏蔽具体模型协议
  ├─ ToolRegistry          提供名称、描述和参数 Schema
  ├─ ToolExecutor          顺序执行并规范化工具结果
  └─ StopPolicy            步数、重试、超时和取消限制

DAGController（AgentLoop 外部）
  ├─ GoalStore
  ├─ GraphStore            保存不可变 GraphVersion
  ├─ NodeRunStore
  ├─ EvidenceStore
  └─ VerificationStore
```

第一版工具按顺序执行即可，不做并行调度。

### 6.3 最小事件词汇

```text
user/message
turn/start
step/start
request
assistant/message
tool/call
tool/result
step/end
turn/end
agent/error
```

建议每个事件至少包含：

- `event_id`；
- `session_id`；
- `sequence`；
- `timestamp`；
- `type`；
- `payload`。

模型上下文只由以下事件投影：

- `user/message`；
- `assistant/message`；
- `tool/result`。

### 6.4 最小算法

```python
async def run_turn(user_input):
    append("turn/start")
    append("user/message", user_input)

    for step in range(max_steps_per_turn):
        append("step/start", step)
        messages = projector.derive(conversation_log)

        try:
            response = await llm.generate(messages, visible_tools)
        except Cancelled:
            append("step/end", reason="aborted")
            append("turn/end", reason="aborted")
            return
        except RetryableError as error:
            # 在有限次数内重试同一 step；取消优先
            response = await retry_same_request(error)

        append("assistant/message", response)

        if not response.tool_calls:
            append("step/end", reason="completed")
            append("turn/end", reason="completed")
            return response.text

        for call in response.tool_calls:
            append("tool/call", call)
            result = await tool_executor.execute(call)
            append("tool/result", result)

        append("step/end", reason="continue")

    append("agent/error", code="MAX_STEPS")
    append("turn/end", reason="blocked")
```

这是概念伪代码。实际实现应确保异常路径不会重复写 `step/end` 或遗漏 `turn/end`。

### 6.5 最小终止保护

第一版至少需要：

- 每个 turn 的最大 step 数；
- 每次工具执行超时；
- 每次模型请求有限重试；
- 统一取消信号；
- 取消后禁止重试；
- 未处理异常写入 `agent/error`；
- 所有终止路径写入 `turn/end`。

## 7. 与 DAG Agent 的结合方式

### 7.1 将 DAG 能力暴露为工具或服务

内层 Agent 通过领域工具操作外层状态，例如：

| 角色 | 可见能力示例 |
|---|---|
| Research | `research_goal`、`save_source` |
| Planning | `create_graph`、`revise_graph`、`request_research` |
| Execution | `get_runnable_node`、`execute_node`、`submit_evidence` |
| Verification | `inspect_evidence`、`record_verdict` |
| Controller | `advance_goal`、`request_replan`、`finish_goal` |

这不是要求第一版全部做成 LLM 工具，而是强调调用接口必须位于 AgentLoop 之外。

### 7.2 用工具权限保持职责分离

PRD 要求 Planning 与 Execution 互不越权。最简单的落地方式不是依赖提示词自觉，而是按当前角色提供不同工具集合：

- Planner 可以创建新图版本，但不能把节点标记完成；
- Executor 可以提交执行结果和证据，但不能修改图；
- Verifier 可以记录通过或失败，但不能直接执行节点；
- Controller 根据验证结果决定推进或进入 Replanning。

### 7.3 会话事实与领域事实分开

建议分开保存：

- **ConversationLog**：模型对话、工具调用及运行边界；
- **GraphStore / EvidenceStore**：图版本、节点运行、证据和验证结论。

会话事件只保存领域对象的 ID、版本和必要摘要。下一次模型请求时，再从领域存储生成当前相关快照并作为一条可追踪的上下文事件进入会话。不要把完整 DAG 的唯一副本埋在聊天消息里。

### 7.4 推荐的最小外层流程

```text
GoalController
  1. 创建 Goal
  2. 调用 Research Agent，保存带来源材料
  3. 调用 Planning Agent，提交 GraphVersion v1
  4. 选择可执行节点
  5. 调用 Execution Agent，提交 NodeRun + Evidence
  6. 调用 Verification Agent，提交 Verdict
  7. Verdict 通过：完成节点并解锁后继
     Verdict 失败：调用 Planning Agent，提交 GraphVersion v2
  8. 所有关键节点完成后结束 Goal
```

各角色可以复用同一个 `AgentLoop` 实现，只使用不同的 system prompt、上下文提供器和工具集合。

## 8. 第一版应坚持的约束

1. **所有模型可见内容都能从记录重建。**
2. **图版本、证据和验证结论先持久化，再推进状态。**
3. **AgentLoop 不导入 DAG 领域类型。**
4. **Planner、Executor、Verifier 使用不同权限面。**
5. **节点完成只能由 Verification 结果触发。**
6. **失败默认进入 Replanning，而不是无条件重做。**
7. **先顺序执行，确认闭环正确后再加入并发和插件热更新。**

## 9. 建议的实现顺序（仅设计）

1. ConversationLog + SurfaceProjector；
2. LLMAdapter + 最小消息类型；
3. ToolRegistry + 顺序 ToolExecutor；
4. 带终止保护的 AgentLoop；
5. GraphStore、EvidenceStore 和 VerificationStore；
6. 角色化工具权限；
7. GoalController 外层 DAG 循环；
8. 最后再评估流式持久化、并发工具、上下文压缩和插件体系。

## 10. 主要源码入口

- `deepseek-harness/docs/architecture.md`：总体架构、标准 turn/step 流程和扩展点；
- `deepseek-harness/packages/core/agent-loop/src/agent.ts`：单对话主循环；
- `deepseek-harness/packages/core/agent-loop/src/index.ts`：Agent 创建、恢复、发布和销毁；
- `deepseek-harness/packages/core/agent-loop/src/tool-calls.ts`：工具调度与有序提交；
- `deepseek-harness/packages/core/session/src/index.ts`：Session 日志和提交语义；
- `deepseek-harness/packages/core/session/src/surface.ts`：模型消息投影；
- `deepseek-harness/packages/core/session/src/request-header.ts`：请求快照；
- `deepseek-harness/packages/core/tools/src/index.ts`：工具注册、权限、执行和结果规范化；
- `deepseek-harness/packages/llm/llm/src/index.ts`：Provider-neutral LLM 注册与调用；
- `deepseek-harness/packages/llm/llm/src/assembler.ts`：流式响应组装；
- `deepseek-harness/packages/llm/llm-deepseek/src/adapter.ts`：DeepSeek HTTP/SSE Adapter；
- `deepseek-harness/packages/llm/llm-retry/src/index.ts`：请求重试；
- `deepseek-harness/packages/core/agent-loop/tests/`：主循环、工具调度、重试和取消行为证据。

## 11. 关于 Thought 与 ReAct 的补充结论

Harness 在消息协议中区分 `text`、`reasoning` 和 `tool-call` 内容块，也能持久化 provider 暴露的 reasoning；但 AgentLoop 不解析、评价或依赖 Thought 来控制流程。循环唯一可信的控制信号是结构化的工具调用、工具结果、finish reason、取消信号和持久状态。

因此它是 function calling 形式的 ReAct-like 循环，而不是要求模型输出 `Thought → Action → Observation` 标签的经典 ReAct。这个选择是合理的：Thought 是 provider 相关且不稳定的生成内容，不应成为状态机协议；如果 SkillWorld 需要可审计决策，应让模型通过结构化工具提交计划、证据、判定理由或图修订，而不是解析自然语言思维链。

AgentLoop 看起来简单是刻意的。其主要工程价值不在增加更多智能分支，而在保证简单循环在流式响应、失败、重试、取消、恢复、并行工具和插件变化下仍然满足：模型可见事实可重建、工具调用与结果配对、请求配置可追溯、所有边界最终收敛。

## 12. 内层 AgentLoop 的最小实现拆解

建议按以下可独立验收的增量实现：

1. **协议类型**：定义 `Message`、`ContentBlock`、`ToolCall`、`ToolResult`、`FinishReason` 和品牌化 ID；reasoning 是可选内容块，不参与流程判断。
2. **ConversationLog**：实现仅追加事件和单调 sequence；先使用内存 Provider，但接口允许替换持久化实现。
3. **上下文投影**：只由 `user/message`、非空 `assistant/message`、`tool/result` 派生 messages；为同一事件前缀保证确定性结果。
4. **LLM seam**：定义 provider-neutral `generate()`；请求包含 provider、model、system、messages、tools 和 `AbortSignal`。第一版可不持久化流式 chunk。
5. **工具 seam**：注册工具 schema 与 executor；校验参数；未知工具、参数错误和业务异常规范化为可回送模型的错误结果。
6. **单步执行**：冻结并记录请求快照，调用 LLM，记录 assistant message；有工具调用则顺序执行并记录 call/result，无工具调用则自然结束。
7. **单轮循环**：追加 turn/step 边界；工具结果后重新投影上下文并进入下一 step；支持最大 step 数。
8. **终止与取消**：统一 `AbortSignal`、模型超时、工具超时、有限重试；所有退出路径只写一次 `step/end` 和 `turn/end`。
9. **Cordis 组合**：将 Conversation、LLM、Tools、AgentRuntime 分别作为 Service；Provider 和策略作为 Plugin；AgentRuntime 只依赖 Service 抽象。
10. **闭环测试**：覆盖“直接回答”“一次工具后回答”“多次工具”“工具错误后恢复”“最大步数”“模型错误”“工具超时”“取消”和“日志重建请求”。

第一版明确不做：并行工具、动态热替换、compaction、子 Agent、多 Profile、完整流式回放和 DAG 领域逻辑。Node 执行器后续把同一个 AgentRuntime 当作能力使用，而不是把 Node/DAG 状态写进内层循环。
