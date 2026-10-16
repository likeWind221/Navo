# F11.0 自动化流程与自主运行架构设计收口

> 日期：2026-10-16  
> 状态：🔄 设计已确认，待进入 F11.1  
> 范围：只收口 Phase 11 的自动化流程；不修改生产代码。记忆/上下文压缩归入 Phase 12，RAG 归入 Phase 13。

## 1. Phase 11 的目标

Phase 10 已经形成完整的 Human Gate 工作流：

~~~text
Human
  ↓
启动 Main / Node Turn
  ↓
Agent 执行
  ↓
Human 决定下一步
~~~

Phase 11 的目标，是在**不改变 Project、Roadmap、Main、Node 的既有职责**的前提下，增加一个程序化的自动驱动层，使一个已经具备明确 Goal 和 Roadmap 的 Project 可以连续运行：

~~~text
Human 显式启动 AutoRun
          ↓
      Auto Driver
          ↓
   Main / Node Turn
          ↓
      产生事件
          ↓
   Reconcile + Dispatch
          ↓
      下一次 Turn
          ↓
        继续推进
~~~

核心问题是：

> **一个 Turn 结束后，系统如何根据当前 Project 事实确定下一步由谁继续工作，并避免重复、冲突和无限运行？**

F11 只解决**自动执行闭环**。上下文压缩和长期知识检索分别留给 F12、F13。

### 1.1 F11 与现有 Human Gate 的边界

F11 的“全自动”指：

> **在已经确认的 Project Goal / Roadmap 范围内，自动完成 Main / Node 的连续执行与复盘。**

F11 **不绕过既有的两个人工 Gate**：

- F9.10：新的 Project 规划或 Roadmap 重大调整仍需用户同意；
- F10.4b：Node 的最终完成仍由 Main 通过 submit_review 作出唯一判定。

因此：

~~~text
已有 Roadmap
    ↓
AutoRun 自动执行
    ↓
Node 自主推进
    ↓
submit_completion
    ↓
Main 自动 Review
    ├── complete → 解锁后继
    ├── rework   → Node 继续
    ├── skip     → 沿用现有跳过语义
    └── ask_human / 需要新规划 → 停止自动推进
~~~

F11 暂不设计 Human-in-the-loop 的交互细节，只保留上述边界；具体接管、审批、恢复 UI 留待后续阶段。

## 2. 现有架构映射：F11 不新增重复领域模型

本次对当前 master 的 ProjectRuntime、Roadmap、Node、NodeSession、Mailbox、ReviewService 和 AgentRuntime 进行映射后，结论是：

| 现有组件 | 已有职责 | F11 的使用方式 |
|---|---|---|
| Project | 长期项目边界与 Goal | AutoRun 的宿主 |
| Roadmap | Node + dependency 的权威 DAG | 直接作为自动调度依据 |
| Node | goal、done_when、依赖、生命周期 | 自动执行的基本工作单元 |
| NodeSession | Node 的连续上下文与多 Turn | 同一 Node 内持续推进 |
| Main Session | 项目级长期上下文 | 自动规划/复盘的执行上下文 |
| ProjectRuntime | Main / Node 执行入口、占用与收口 | Auto Driver 的执行落点 |
| Mailbox | Node → Main 的项目级消息 | 触发 Main 自动处理 |
| ReviewService | submit_review 完成/返工/跳过/Human 判定 | 自动复盘直接复用 |
| AgentRuntime | 通用 Agent 执行引擎 | Main / Node 继续共用 |

因此 F11 **不新增**：

- Work Graph：Roadmap 本身就是项目任务图；
- Task Packet：Node 本身已经携带目标、完成标准、依赖和 Session；
- MainAgentRuntime / NodeAgentRuntime：继续复用唯一 AgentRuntime；
- 独立 Workflow Engine：自动流程由 Auto Driver 消费现有领域状态完成。

## 3. Auto Driver 的定位

Auto Driver 是**程序控制层，不是另一个大脑**。

~~~text
                 ┌──────────────────┐
                 │      Main        │
                 │ 项目级决策 / 复盘 │
                 └────────┬─────────┘
                          │
                 ┌────────▼─────────┐
                 │      Node        │
                 │ 具体任务自主执行  │
                 └────────┬─────────┘
                          │
                    Domain Events
                          │
                 ┌────────▼─────────┐
                 │   Auto Driver    │
                 │ Reconcile/Dispatch│
                 └────────┬─────────┘
                          │
                     下一次 Turn
~~~

Auto Driver 负责：

1. 监听/接收 Project、Node、Mailbox、Turn 等变化；
2. 将事件合并为一次幂等的 Reconcile；
3. 根据 Roadmap 和现有生命周期判断谁现在可以运行；
4. 调用已有 ProjectRuntime / NodeSession 启动或继续 Turn；
5. 防止同一个 Main / Node 被重复启动；
6. 记录本次 AutoRun 的回合预算与停止原因；
7. 在完成、失败、阻塞、取消、中断等终点停止或继续调度。

Auto Driver **不负责**：

- 不自己进行 LLM 推理；
- 不替 Main 决定项目方向；
- 不替 Node 完成任务；
- 不直接修改 Roadmap；
- 不创建新的 AgentRuntime。

## 4. AutoRun 生命周期

F11.0 不再新增一个持久化的 manual / auto Project 领域状态机。自动化首先被定义为**一次运行许可（AutoRun）**：

~~~text
IDLE
  │ start
  ▼
RUNNING
  │
  ├── 正常完成 ──→ COMPLETED
  ├── 失败/中断 ─→ PAUSED
  ├── 无可执行节点 ─→ PAUSED
  └── 达到预算 ──→ PAUSED
~~~

AutoRun 至少需要在运行时记录：

- runId
- status
- mainTurnCount
- nodeTurnCount
- 当前活跃 Main / Node
- 最近一次停止原因

其中 Project / Roadmap / Node 仍然是**事实来源**，AutoRun 只记录本次自动运行过程。

同一 Project 同时只能存在一个有效 AutoRun；同一 AutoRun 内同一 Main 不得并发两个 Turn，同一 Node 不得并发两个 Turn。

## 5. 自动推进闭环

### 5.1 基本调度循环

每次 Turn 或领域事件收口后，Auto Driver 都进入一次 Reconcile：

~~~text
Event
  ↓
Reconcile
  ↓
读取 Project / Roadmap / Node / Mailbox 当前事实
  ↓
判断当前最高优先级动作
  ↓
Dispatch 一个或多个合法 Turn
  ↓
等待新的 Event
  ↓
再次 Reconcile
~~~

Reconcile 必须是幂等的；同一 Project 同时到来的多个事件可以合并，不能因为一个事实变化触发多个重复 Turn。

### 5.2 Main / Node 自动推进顺序

在 AutoRun = RUNNING 时，按以下顺序处理：

~~~text
Reconcile
   │
   ├─ Project 已完成/归档/不可运行
   │       → COMPLETED / STOP
   │
   ├─ 存在未处理的 Node → Main 请求
   │       → Main Turn
   │
   ├─ 存在 submitted Node
   │       → Main Review Turn
   │
   ├─ 存在已经开始但尚未完成的 Node
   │       → 继续该 Node Session
   │
   ├─ 存在 eligible Node
   │       → 启动 Node Turn
   │
   └─ 无 eligible Node
           → PAUSED
             等待用户批准新的 Roadmap / 规划
~~~

这里有三个关键规则：

**第一，Main 不是自由聊天循环。**

Main 只因明确的项目级事件被唤醒：

- Node 发送 Project-level request；
- Node 已 submitted，需要 Main Review。

Main Turn 必须产生可观察的领域动作或判定；普通文本输出不能再次自触发 Main。

**第二，Node Turn 结束不等于 Node 完成。**

~~~text
Node Turn 1
    ↓
正常结束、未 submit_completion
    ↓
继续同一 Node Session
    ↓
Node Turn 2
    ↓
...
    ↓
submit_completion
    ↓
submitted
    ↓
Main Review
~~~

只有 submit_completion 才进入 F10.4b 的 Main Review。

**第三，Roadmap 没有可执行节点时，不允许 Main 自动绕过 F9.10 重新规划。**

此时自动流程停止，等待用户批准新的规划/路线后再继续。

## 6. Node 并行与资源边界

F11.0 从架构上支持多个独立 Node 并行，但首版实现默认：

> maxConcurrentNodes = 1

原因是当前 Project Workspace 是共享真实目录；已有文件级并发控制只能防止部分写冲突，不能证明两个 Node 在语义上可以安全并行。

因此调度原则冻结为：

~~~text
A ──→ C
B ──→ C

A、B 无依赖
    ↓
理论上可以并行

C 依赖 A、B
    ↓
必须等待
~~~

进一步放开并行时必须同时满足：

- Roadmap dependency 不冲突；
- Node 不共享同一个正在变更的资源；
- 不违反现有 Workspace / Resource 权限；
- 不绕过 ProjectRuntime 的 Node 占用保护。

因此：

- **F11.1** 先做单 Node 自动闭环；
- **F11.2** 再实现多 Node 调度；
- **F11.3** 再放开并行与资源冲突控制。

## 7. Node → Main 自动唤醒

现有 Mailbox 已经承担 Node → Main 的事实记录，但过去不会自动启动 Main。

F11 的变化是：

~~~text
Node
  ↓
send_to_main
  ↓
Mailbox 持久化
  ↓
Domain Event
  ↓
Auto Driver Reconcile
  ↓
Main Turn
  ↓
read_mailbox
  ↓
处理请求
~~~

这里必须解决**重复唤醒**：

- 同一 Mailbox 消息只能被一次自动 Main Turn 消费；
- Driver 必须记录已处理的消息位置/序号；
- 同一消息不能因为多次 Reconcile 被重复触发 Main；
- 消息进入 Mailbox 不直接递归调用 Main，而是统一经过 Auto Driver 调度。

## 8. Main Review 与 Roadmap 边界

Main Review 继续严格复用 F10.4b：

~~~text
submitted Node
      ↓
Main Review
      ↓
submit_review
 ┌────┼────┬──────────┐
 ↓    ↓    ↓          ↓
完成  返工  跳过     交给 Human
~~~

其中：

- complete：沿用 F10.4b，完成 Node 并解锁合法后继；
- rework：把 Node 返回可执行状态，并将反馈送入下一 Turn；
- skip：沿用现有跳过语义；
- ask_human：停止 AutoRun。

**Main 可以在已有用户批准的 Roadmap 范围内推进和复盘，但不能通过 AutoRun 绕过 F9.10 新增一条未经用户同意的规划路线。**

这保证 F11 的自动化是：

> **自动执行已经确定的工作，而不是自动替用户决定新的项目方向。**

## 9. 回合预算

预算按**一次连续 AutoRun**计算，而不是 Project 生命周期累计：

| 预算 | 首版默认值 | 计数对象 |
|---|---:|---|
| Node Auto Turns | 64 | 实际进入执行的自动 Node Turn |
| Main Auto Turns | 32 | 实际进入执行的自动 Main Turn |

规则：

- 排队后未真正进入 Turn 的请求不计数；
- Human 主动发起的 Turn 不计入 AutoRun；
- 任一预算达到上限，AutoRun → PAUSED，停止自动启动新 Turn；
- 新的 AutoRun 重新计数；
- F10 已有的单 Turn maxSteps = 150 继续有效；
- AgentRuntime 自身已有的瞬时/模型级错误处理不由 F11 重复实现。

64 / 32 是首版安全上限，用于防止自动流程无限运行；后续通过 F11 长程验收再调整。

## 10. 失败、取消、中断与重启

### 10.1 Turn 级异常

~~~text
Turn
 │
 ├─ success
 │    └→ Reconcile → 继续
 │
 ├─ failed
 │    └→ PAUSED
 │
 ├─ cancelled
 │    └→ PAUSED
 │
 └─ interrupted
      └→ PAUSED
~~~

F11.0 的原则是：

> **完整 Turn 失败后默认不自动重跑。**

避免因为旧事件、网络异常或状态竞争造成重复副作用。后续如果需要有限重试，应作为独立设计，不隐式加入 F11.0。

### 10.2 AutoRun 级停止

以下情况统一停止自动推进：

- Node / Main Turn failed；
- Node / Main Turn cancelled；
- Node / Main Turn interrupted；
- Main Review 返回 ask_human；
- 达到 Main / Node 回合预算；
- Roadmap 无 eligible Node 且需要新的规划；
- Project 已完成、归档或不可运行。

应用重启后：

> **不恢复原 AutoRun 的运行态，不自动唤醒 Agent。**

已有 Project / Roadmap / Node / Session 事实继续从 SQLite 恢复，但需要重新建立 AutoRun。

## 11. F11.0 验收标准

F11.0 只验收设计，不修改生产代码：

- [x] 明确 Phase 11 只负责自动执行，不负责 F12/F13；
- [x] 明确 Roadmap 即项目任务图，不新增 Work Graph；
- [x] 明确 Node 自带 Goal / done_when，不新增 Task Packet；
- [x] 明确 Auto Driver 是程序调度层，不是 Agent；
- [x] 明确 AutoRun 生命周期；
- [x] 明确 Event → Reconcile → Dispatch 闭环；
- [x] 明确 Node 多 Turn 连续推进；
- [x] 明确 submit_completion → Main Review 边界；
- [x] 明确 Node → Main 自动唤醒与消息去重；
- [x] 明确 Main 同时最多一个 Turn、Node 同时最多一个 Turn；
- [x] 明确多 Node 并行的架构支持与首版默认串行；
- [x] 明确 F9.10 新规划需用户同意，不被 AutoRun 绕过；
- [x] 明确 F10.4b submit_review 仍是 Node 完成的唯一判定；
- [x] 明确 64 / 32 AutoRun 回合预算；
- [x] 明确失败、取消、中断、预算耗尽和无可执行节点的停止语义；
- [x] 明确重启不自动恢复 AutoRun；
- [x] 明确 F11.1–F11.4 最小开发顺序。

## 12. 下一步最小开发顺序

~~~text
F11.0  设计确认
   ↓
F11.1  单 Node 自动闭环
       AutoRun
        → Node Turn
        → Node 继续 Turn
        → submit_completion
        → Main Review
        → 下一 Node
   ↓
F11.2  Auto Driver 多 Node 调度
       Roadmap eligible / blocked
       Main 唤醒 / 事件去重
   ↓
F11.3  并行与资源冲突控制
       maxConcurrentNodes > 1
   ↓
F11.4  长程自动化验收
       完成 / 返工 / 跳过 / 异常 / 重启
~~~

F11 的最终完成标准：

> **在一个已经确认 Goal 与 Roadmap 的 Project 中，Human 只需启动一次 AutoRun，Navo 即可通过 Auto Driver 连续驱动 Node 多 Turn 执行、自动触发 Main Review、按照 Roadmap 依赖继续推进，并在完成、异常、预算耗尽或需要新的人工规划时明确停止。**
