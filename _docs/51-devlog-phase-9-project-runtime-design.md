# Phase 9 设计记录：Project-Oriented Multi-Agent Roadmap Runtime

> 本文记录 Phase 9 开发前的架构收口。它解释当前设计为什么从“Roadmap + Scheduler + Coordinator”调整为“Project + Main Agent + Roadmap Board + isolated Node Agent”，以及现有 Node 包在新架构中的位置。本文只记录设计，不代表对应代码已经实现。

## 1. 背景：上一版抽象为什么不够

最初的 Phase 9 草案把主流程理解为：

```text
Goal
  -> Roadmap
  -> Scheduler
  -> Coordinator
  -> AgentRuntime
```

这更像一个长期 Workflow Engine：Roadmap 主要回答“下一项 Task 是什么”，Scheduler 和 Coordinator 成为系统中心。但 Navo 的目标产品不是把一组 Task 在后台依次跑完，而是让用户长期进入一个 Project Workspace，持续看到、干预和理解整个项目的推进状态。

新的产品要求是：

1. 一个 Project 有一个长期负责全局目标和路线的 Main Agent；
2. Roadmap 是长期存在、可视化的项目地图/看板，是用户与 Agent 共同看到的权威状态；
3. 每个 Roadmap Node 是独立工作单元，由自己的 Node Agent 和持续 Session 推进；
4. Node Agent 之间严格隔离，不能直接通信；
5. Node 可以向 Main Agent 报告完成、阻塞、缺口和协调请求；
6. Main Agent 可以修改 Roadmap、创建或调整 Node，并向 Node 下发新的指令；
7. 所有 Agent 角色复用同一个通用 AgentRuntime。

因此 Phase 9 的中心从“任务调度器”改为“长期 Project 治理”。

## 2. 最终架构方向

```text
                             Project
                                |
             +------------------+------------------+
             |                  |                  |
             v                  v                  v
            Goal          Roadmap Board       Main Binding
                               |                  |
                               |             Main Profile
                               |                  |
                               |             Main Session
                               |                  |
                               |                  v
                               |             AgentRuntime
                               |                  |
                               |          planning / directive
                               |                  |
             +-----------------+------------------+
             |                 |                  |
             v                 v                  v
           Node A            Node B             Node C
             |                 |                  |
       Node Binding       Node Binding        Node Binding
             |                 |                  |
       Node Profile       Node Profile        Node Profile
             |                 |                  |
       Node Session       Node Session        Node Session
             |                 |                  |
             +-----------------+------------------+
                               |
                          AgentRuntime

Node A --------------X--------------> Node B
Node A ---- report ---> Main Agent ---> directive ----> Node B
```

这里有两个重要事实：

- `AgentRuntime` 是共享执行内核，不区分 Main / Node；
- Project / Roadmap 的长期状态不属于 AgentRuntime，也不等同于任何 Session。

## 3. 生命周期分层

Phase 9 以后需要明确区分四个生命周期：

```text
Project lifetime
-------------------------------------------------------->

Main Session
-------------------------------------------------------->

Node A Session
        -------------------------->

Node B Session
                 ------------------------------>

Agent Turn
        -->   -->        -->     -->       -->
```

### Project

最长生命周期。保存长期 Goal、Roadmap、项目级事件和 Main / Node 的归属关系。关闭应用再打开后，项目语义上仍应可以恢复。

### Roadmap / Node

Roadmap 是 Project 的持续计划和进度状态；Node 是 Roadmap 中可独立推进的工作单元。Node 的生命周期通常跨多个 Turn，必要时跨多次应用启动。

### Session

Session 只承担某个 Agent 的连续模型上下文和执行日志。Main Agent 有自己的 Main Session，每个 Node Agent 有自己的 Node Session。Session 不是 Roadmap Store。

### Turn

AgentRuntime 的最小执行单位。一次 Turn 可以调用多步模型和工具，但不承担 Project 外循环。

## 4. 为什么只保留一个 AgentRuntime

现有 `AgentRuntime` 已经有合适的抽象：调用者提供 Session、system prompt、模型和工具白名单，Runtime 负责模型 -> 工具 -> 模型闭环、Turn/Step 生命周期、重试、取消和事件记录。

因此 Main Agent 与 Node Agent 不需要两套执行类：

```text
Main Agent
= AgentRuntime
+ MainProfile
+ ProjectBinding
+ MainSession

Node Agent
= AgentRuntime
+ NodeProfile
+ NodeBinding
+ NodeSession
```

以后 Coding、Research、Writing 等 Node 工作方式也应优先继续表达为不同 Profile 或领域适配，而不是继续增加 `CodingAgentRuntime`、`ResearchAgentRuntime` 等平行 Runtime。

### AgentRuntime 的长期边界

AgentRuntime 应保持不知道以下概念：

- Project；
- Roadmap；
- Main Agent / Node Agent 角色；
- Research / Coding / Learning 领域；
- Node 之间的依赖和通信。

它只执行被调用者已经准备好的一个 Agent Turn。

## 5. Profile、Binding 与授权是三层不同概念

只靠 Prompt 写“你是 NodeAgent，不允许访问其他 Node”不是可靠隔离。Phase 9 以后把角色能力拆成三层：

```text
AgentProfile
    |
    | model-visible role + tool names
    v
AgentRuntime
    |
    | trusted execution context
    v
AgentBinding
    |
    | actual project/node/session ownership
    v
Store / Tool authorization
```

### Profile

告诉模型当前角色、当前上下文、工作方式和可见工具。例如 Main Profile 可以看到 Roadmap 管理工具；Node Profile 可以看到搜索、文件和 `report_to_main`。

### Binding

可信运行时事实，描述当前 Session 实际属于哪个 Project，若是 Node Session 则还属于哪个 Node。Binding 不由模型自由提交。

### Store / Tool authorization

最终写入前再次依据 Binding 校验作用域。即使模型伪造参数，也不能修改其他 Node 或获得 Project 管理权限。

当前 Node 内容工具已经体现了这种思路：模型调用工具时不选择任意 NodeId，而是使用 Runtime 注入的 SessionId 反查所属 Node。Phase 9 应延续并泛化这一模式。

## 6. Main Agent 与 ProjectRuntime 的职责分离

两者容易被混淆，需要在 Phase 9 明确区分。

### Main Agent：负责决策

Main Agent 是 Project 的全局认知和决策角色，负责：

- 理解长期 Goal；
- 规划初始 Roadmap；
- 根据项目进度决定下一步；
- 处理 Node 报告和阻塞；
- 提议新增、跳过、替换、重排 Node；
- 向指定 Node 下发协调指令；
- 在未来 Verification 失败时进行 Replanning。

这些属于模型决策，不应由普通确定性 Scheduler 代替。

### ProjectRuntime：负责可信执行

ProjectRuntime 不“思考项目应该怎么做”，只负责把合法决策可靠落实，例如：

- 管理 Project 生命周期；
- 取得当前 Roadmap / Project 快照；
- 根据已提交关系派生 Node eligibility；
- 启动或停止被允许的 Node 执行；
- 路由 Main / Node 消息；
- 保证同一 Node 的执行约束和跨 Node 并行边界；
- 校验并提交 Roadmap Mutation；
- 处理取消、失败、恢复和资源清理。

可以把二者理解为：

```text
Main Agent:     what should happen?
ProjectRuntime: may it happen, and how is it committed safely?
```

## 7. Roadmap 是项目事实，不是一次规划结果

Roadmap 的后端定义应服务于长期 Project，而不是服务于一次 LLM 调用。

```text
Roadmap
  +-- Node references
  +-- Relations
  +-- Node progress / lifecycle facts
  +-- Version
  +-- Mutation history
  +-- Mutation reason
  +-- derived eligibility
```

用户最终看到的是 Roadmap 的稳定 Projection：

```text
Roadmap facts
    +
Node execution state
    +
future Verification state
    |
    v
Project Board Projection
    |
    v
visual board / game map
```

UI 的空间坐标、动画和具体布局不进入 Phase 9 Core 事实模型；Core 可以后续提供必要的 group / phase / display hint，但不能让视觉布局决定执行语义。

## 8. Roadmap 不是严格 DAG

Navo PRD 已明确 Roadmap 需要表达不同关系：

```text
hard dependency   A -> B
soft order        A ~> B
parallel          A -> B
                  A -> C
skippable         A ------> C
replaceable       B -> B'
dynamic insert    A -> X -> B
```

因此不能让所有关系都落成“有向边 + 拓扑排序”。

Phase 9 的建议不变量是：

- hard dependency 决定是否具备执行资格；
- hard dependency 子图应避免形成不可满足循环，否则 Project 会永久无可执行节点；
- soft order 只影响 Main Agent / Board 的推荐顺序，不作为硬阻塞；
- parallel 是多个 Node 同时满足资格后的允许执行形态，不必额外伪造成一种依赖边；
- skip / replace / insert 是 Roadmap Mutation 语义，需要留下版本和原因；
- `ready` / `eligible` 优先作为当前 Roadmap Snapshot 的派生结论，而不是独立可漂移的事实字段。

因此 Phase 9 不再单独以 `Scheduler` 为一级核心模块。若实现中需要纯函数计算 eligibility，它只是 Roadmap / ProjectRuntime 的确定性能力。

## 9. Main Agent 提议不等于 Roadmap 已修改

LLM 输出必须与可信领域提交分开：

```text
Main Agent
   |
   v
Mutation Proposal
(baseVersion = N)
   |
   v
Deterministic validation
   |             |
 invalid       valid
   |             |
 reject          v
             commit N+1
                 |
                 v
          Roadmap Event / Snapshot
```

未来 insert / skip / replace / reorder 等操作至少需要检查：

- Proposal 针对的 Roadmap 版本是否仍是当前版本；
- 被引用 Node 是否存在且属于当前 Project；
- 关系是否符合 Roadmap 不变量；
- 变更是否越过角色权限；
- Mutation 是否留下可追溯原因。

这保证 Main Agent 负责智能决策，但最终 Project 状态仍然确定、可重放、可测试。

## 10. Project Mailbox：唯一跨 Agent 协调通道

Node Agent 之间不能直接通信。必须形成明确拓扑：

```text
Node A ----X----> Node B
Node B ----X----> Node C

Node A ---> Project Mailbox ---> Main Agent
Main Agent ---> Project Mailbox / Directive ---> Node B
```

### Node -> Main

Node 可以报告：

- progress / completion；
- blocked；
- missing context；
- request coordination；
- proposed roadmap gap；
- execution failure summary。

`report_to_main` 不应在工具内部同步调用 Main Agent。正确生命周期是：

```text
Node Turn
   |
   v
commit Report Event
   |
   v
Node Turn ends
   |
   v
Project Inbox has pending report
   |
   v
Main Agent later consumes it in its own Turn
```

### Main -> Node

Main Agent 可以向指定 Node 提交 directive。ProjectRuntime 再把该 directive 注入目标 Node 的可信执行路径。Node 只收到属于自己的信息，不获得其他 Node Session 或完整私有上下文。

这种异步 Mailbox 模型可以阻止同步递归：

```text
Node -> Main -> Node -> Main -> ...
```

并使每条跨 Agent 协调都可以记录和重放。

## 11. 现有 `src/node` 的迁移策略

Phase 6 的 Node 不是废弃资产。它当前虽然绑定 SkillWorld 学习语义，但内部机制与新架构高度一致。

| 现有 Node 能力 | Phase 9 处理 |
|---|---|
| `NodeId` | 保留，继续作为 Roadmap Node 身份 |
| NodeEvent + revision | 保留事件流 / 重放模式，并泛化领域事件 |
| `NodeStore` | 保留 Store / Projector 设计思路，去除 Learning 专属写入 |
| `projectNode()` | 保留严格快照重建和不变量校验思想 |
| Node <-> Session 一对一 | 核心保留 |
| 同 Node FIFO | 保留 |
| 跨 Node 并行 | 核心保留，并由 ProjectRuntime 组织 |
| NodeAgent Profile | 泛化成 Project Node Profile |
| Session 来源授权 | 保留并扩展成 Node Binding 授权 |
| `CapabilityTarget` | 演进为通用 Node Objective / Acceptance 边界，具体命名在 F9.2 决定 |
| Material / ExerciseSet | 退出 Navo Core；若未来 Learning Mode 需要，由领域适配层承载 |
| Node 内容专属工具 | 不作为 Generic Node Core；后续由领域 Profile 决定是否重新提供 |

迁移原则是“保留验证过的生命周期和安全边界，替换领域语义”，而不是删除 `src/node` 后从零写另一个 Task 系统。

## 12. Store 与事件边界

现有 SessionStore 和 NodeStore 已经验证追加事件、连续序号/版本、先校验再提交、投影重建和观察者失败隔离等模式。

Phase 9 可以复用这种**模式和必要的低层机制**，但不要把所有事实塞进 `SessionEvent`：

```text
SessionEvent   = Agent execution / conversation facts
NodeEvent      = one Node's domain / lifecycle facts
ProjectEvent   = Project-level ownership / coordination facts
RoadmapEvent   = Roadmap version / mutation facts
```

最终是否合并 ProjectEvent 与 RoadmapEvent，或抽取共享事件存储 helper，应由对应 Step 在看到真实协议后决定。当前设计阶段不提前建立通用 Event Framework。

## 13. Verification 边界

Phase 9 需要能表达 Node 执行结果和“等待验证”的边界，但不实现完整 Evidence / Verification 系统。

```text
Node execution result
        |
        v
Phase 9 execution boundary
        |
        +----> continue / report / blocked

Phase 10
        |
        v
Evidence -> Verification -> trusted verdict
```

Node Agent 不能因为自己输出“完成了”就获得最终可信完成结论。Phase 10 会把证据与独立 Verification 接回 Project 外循环。

## 14. 与 DeepSeek Harness 的关系

当前仓库没有可供 Phase 9 直接照搬的 DeepSeek Harness Project/Roadmap 多 Agent 编排源码；已有 Harness 调研主要验证了单对话 Agent Loop、生命周期、流式模型、工具、取消等边界。

Phase 9 因此继续保留已完成 AgentRuntime 的 Harness 风格职责：单 Turn 执行、模型/工具边界、取消和生命周期保持通用；Project、Roadmap、Main/Node Binding、Mailbox 和长期编排属于 Navo 自己的产品层，应通过确定性状态与测试建立可靠性，而不是伪称与 Harness 的项目编排实现一致。

## 15. Phase 9 开发顺序

```text
F9.0  Architecture closure                 [done]
  |
  v
F9.1  Project Domain
  |
  v
F9.2  Generic Project Node
  |
  v
F9.3  Persistent Roadmap Board
  |
  v
F9.4  Agent Profile + Binding
  |
  v
F9.5  Main planning + Mutation Gate
  |
  v
F9.6  Project Mailbox
  |
  v
F9.7  ProjectRuntime orchestration
  |
  v
F9.8  Long-horizon Core integration
  |
  v
F9.9  Public contract handoff
        ^
        before this step: stop and coordinate with frontend
```

具体功能完成标准以 `_docs/backend-plan.md` 为准。每个 Step 开始前再确定最小协议和目标文件，不在本设计记录中提前固化所有类型字段。

## 16. 本次收口的非目标

本次 F9.0 设计不实现：

- Project、Roadmap 或 Mailbox 代码；
- Main Profile 或 Node Profile 新代码；
- Node 模块迁移；
- Scheduler；
- Evidence / Verification；
- Research RAG / Claim-Evidence Graph / LaTeX；
- Host、RPC、共享桌面契约或前端 Roadmap UI；
- 数据库持久化方案。

这次提交只修改后端计划与设计文档，为 F9.1 开发建立统一边界。
