# F11.0 全自动推进与上下文压缩设计收口

> 日期：2026-10-16  
> 状态：🔄 设计已落地，待用户确认  
> 范围：只收口 Phase 11 的行为契约；本记录不修改生产代码。
> 保留理由：本记录同时承担 F11.0 的状态机、调度、预算、失败边界与压缩契约单一设计入口，超过 300 行是为了避免把同一设计拆成多个相互漂移的控制文档。

## 1. 设计目标

F11 不改变 F10 已形成的 Project / Roadmap / Main / Node 领域职责，而是在其上增加一个可控的自动驱动层：

    Project / Roadmap
           |
      +----+----+
      |         |
    Manual     Auto
      |         |
  Human Gate  Auto Driver
                  |
          +-------+-------+
          |               |
       Node Turn       Main Turn
          |               |
     结果 / 提交       复盘 / 规划 / 求助
          |               |
          +------->-------+
                  |
             下一决策点

核心原则：

1. 自动模式不是“取消 Human Gate”，而是把人工介入点从“每个正常回合”收缩为“模式切换、暂停、停止条件、高风险操作、无法确定的决策”。
2. 状态事实仍由 Project / Roadmap / Node / Session 持有；自动驱动只负责调度，不创建第二套 AgentRuntime。
3. 任何失败默认 fail-closed：失败不会被隐式无限重试；只有 Human 明确恢复后才重新进入自动推进。
4. 上下文压缩只改变模型可见 Surface，不删除原始 Session 事件，保证长期任务可追溯和可恢复。

## 2. 人工 / 全自动模式状态机

### 2.1 两层状态

Project 增加的语义分为两层：

- mode: manual | auto，持久化，由 Human 修改。
- autoState: paused | running，描述当前自动执行是否获准继续；暂停原因持久化。

这样避免把“选择了全自动”与“现在正在运行”混成一个状态。

    Human switch
       |
    MANUAL -----------------> AUTO
       ^                       |
       |                  start / resume
       |                       |
       |                       v
       +-------------------- PAUSED <------+
                              |            |
                           resume      pause / stop
                              |            |
                              +-> RUNNING -+

具体规则：

- 新建 Project 默认 manual。
- manual -> auto：只记录模式切换；当前正在执行的 Turn 不打断，在该 Turn 收口后的下一个决策点开始自动推进。
- auto/running -> manual：同样不打断当前 Turn；当前 Turn 收口后不再自动启动下一回合。
- auto/running -> paused：立即禁止新的自动 Turn；正在执行的 Turn 默认继续到自然收口。若 Human 明确执行“取消当前回合”，才走取消语义。
- auto/paused -> running：必须由 Human 明确恢复；恢复时重新建立本次自动运行的回合预算。
- 应用重启后，即使 Project 的 mode 仍为 auto，也必须恢复为 paused，等待 Human resume。不得因为恢复数据库而自行唤醒 Agent。
- Project complete / archived 时强制停止自动推进。

### 2.2 自动运行预算

预算按“一次连续 Auto Run”计，不是 Project 生命周期累计值：

| 预算 | 默认值 | 计数对象 |
|---|---:|---|
| Node auto turns | 64 | 实际进入执行的自动 Node Turn |
| Main auto turns | 32 | 实际进入执行的自动 Main Turn（复盘 / 规划） |

- 仅排队但因竞态、模式切换或暂停而未进入 Turn 的任务不消耗预算。
- Human 主动发起的 Main / Node Turn 不消耗 Auto Run 预算。
- 达到任一预算上限即 autoState=paused，记录 turn-limit。
- Human resume 后预算清零重新计数。
- F10 已有的单 Turn maxSteps=150、模型重试等限制继续有效；F11 不重复定义它们。

选择 64 / 32 的目的不是追求“跑得越久越好”，而是给一个 Project 足够完成多节点 + 返工的连续运行空间，同时避免无人值守无限增长。后续若真实长程数据证明不足，再做配置化调优。

## 3. Main / Node 自动推进顺序

### 3.1 一个决策点只允许一个调度决策

自动驱动在每个 Project 决策点按以下优先级执行：

    Decision Point
          |
          +-- Project 非 active / Auto 非 running --> STOP
          |
          +-- Human Main input pending ------------> Main Human Turn
          |
          +-- pending Node review -----------------> Main Review Turn
          |
          +-- eligible Node -----------------------> Node Turn(s)
          |
          +-- 无 eligible Node，但仍有未完成工作 --> Main Planning Turn
          |
          +-- 无法继续 / 无法判断 ----------------> PAUSE + Human

Human 输入优先于所有自动任务；同一 Project 内 Main 仍然最多一个 Turn。

### 3.2 Node 启动规则

eligible Node 必须同时满足：

- Project 为 active；
- Node 为 idle；
- 所有 required dependency 已满足；
- Node 不存在待确认 / 待复盘状态；
- Node 未被其他 Main / Node Turn 占用；
- Node 属于当前 Roadmap；
- Node 是从未执行，或最近一次 Main 复盘明确要求返工后重新进入 idle。

同一决策点可启动多个互不冲突的 eligible Node；不同 Node Turn 可以并行，但同一个 Node 永远不并发。

稳定顺序使用 Roadmap 当前拓扑顺序作为 tie-breaker，不依赖 Map / UUID 遍历顺序。

### 3.3 Node 完成后的 Main 复盘

Node Turn 结束后：

    Node Turn
       |
       +-- normal stop / complete signal --> pending review
       |
       +-- failed / cancelled / interrupted --> PAUSE

“Node 没有提交完成信号”不等于失败。只要 Turn 正常结束，仍交给 Main 判断；这延续 F10.4b 的“执行 -> 复盘 -> 再规划”。

多个 Node 同时结束时，Main 按 Node Turn 完成进入 Project 的顺序逐个复盘，不并发复盘。

Main 每次复盘必须给出一个明确结果：

- complete：Node 完成，按现有 Roadmap 规则解锁后继；
- rework：给出具体反馈，Node 回到可执行状态；
- skip：按现有规则跳过；
- ask_human：自动推进暂停，等待 Human。

Main 可以按 F10.4b 修改下游 Roadmap，但不得在一次复盘中直接越权确认另一个尚未执行的 Node 已完成。

### 3.4 没有可运行 Node 时

如果 Roadmap 尚未完成，但没有 eligible Node，不能静默等待：

1. 自动启动一次 Main Planning Turn。
2. Main 读取当前 Goal、Roadmap、Node / Resource / Mailbox 状态。
3. 可以做合法的下游规划调整。
4. 如果仍无法形成可执行路线，必须 ask_human，自动暂停。

这条规则用于避免“所有 Node 都 idle，但 Project 永远不动”的隐性死锁。

## 4. 失败、取消与中断

| 情况 | 当前回合 | 是否复盘 | Auto 后续 |
|---|---|---|---|
| Node 正常结束 | 收口 | 是 | Main Review |
| Node failed | 收口 | 否 | 立即暂停 |
| Node cancelled | 收口 | 否 | 立即暂停 |
| Node 被应用中断 | 收口为 interrupted | 否 | 重启后保持暂停 |
| Main Review failed | 收口 | 无有效判定 | 暂停 |
| Main Review cancelled / interrupted | 收口 | 无有效判定 | 暂停 |
| 达到 Node / Main Auto Turn 上限 | 收口 | 当前已有结果照常处理 | 暂停 |
| Main ask_human | 收口 | 已有判定 | 暂停 |
| 高风险操作 | 不执行 | 不进入下一自动动作 | 暂停等待 Human |

原则：

- F10 的模型级 transient retry 仍可在一个 Turn 内发生；F11 不对完整 Turn 做自动无限重试。
- 失败不会自动重跑同一个 Node，避免“失败 -> 自动再跑 -> 继续失败”的失控循环。
- Human resume 后，失败 Node 可以作为普通 idle Node 再次进入调度，但这是一次新的、明确授权的 Auto Run。
- 已经产生 submitted 的 Node，即使之前发生其他 Node 失败，也不丢失其待复盘事实。
- 取消优先级高于后续自动调度；取消后不得因为旧的调度事件再次启动。

## 5. 高风险操作边界

Auto 模式只自动执行当前权限模型已经允许的普通项目内工作。以下动作视为高风险，默认不自动执行：

- 删除或覆盖 Project 外既有数据；
- 对外发送、发布、提交不可逆外部变更；
- 读取、传输凭据、Token、Secret 或其他敏感数据；
- 修改权限、安全策略、执行策略或运行时配置；
- 可能造成系统级、生产级或不可逆副作用的 Shell / Tool 操作；
- Main 无法确认目标、范围或影响边界的动作。

处理方式：

    Auto Tool Call
          |
          v
    Risk Classification
       |           |
     normal     high / ambiguous
       |           |
      allow      DO NOT EXECUTE
       |           |
    continue    auto paused
                    |
               Human decision

F11.0 不引入第二个 LLM Reviewer 作为第一版依赖。参考 DeepSeek Harness 的 Auto Review 风险分级思想，但 Navo 第一版采用更保守的“高风险即暂停”策略，避免在主 Agent 之外再增加一个自动授权模型；后续如确有需要，再独立设计 Reviewer。

## 6. 上下文压缩契约

### 6.1 压缩对象

压缩的是 model-visible Session Surface，不是历史日志：

    Session Log（完整保留）
        |
        +--> Turn / Step / Tool / Error / Usage
        |
        +--> Message Surface
                 |
                 +--> old history --> [Summary Checkpoint]
                 |
                 +--> recent tail --> 原样保留

因此：

- 原始 Turn / Step / Tool / Error / Usage 事实永久保留；
- 被压缩消息只从后续模型请求的 Surface 中移出；
- 新摘要作为一个可回放的 checkpoint message 替换旧范围；
- 重启后按 Session 日志恢复同一个 checkpoint，不重新执行已完成工具。

### 6.2 自动触发

F11.1 实现统一 Context Meter。每次真正发起模型请求前检查：

estimated_input_tokens + reserved_output_tokens

与模型有效 contextWindowTokens 的关系。

首版默认策略：

- 80%：达到约 0.80 × contextWindow 时触发主动压缩；
- 16% recent tail：保留最近约 0.16 × usable input budget 的历史原文；
- 系统提示、当前请求头等受保护内容永不被压缩；
- 如果模型没有可靠的 contextWindowTokens 元数据，不猜测容量；使用显式 provider/model 配置，否则只依赖 provider 明确返回的 context-overflow 错误。

触发逻辑：

    Before Model Request
            |
       measure context
            |
       +----+----+
       |         |
     below      >= 80%
       |         |
     request   compact oldest safe prefix
                    |
               +----+----+
               |         |
            success    failure
               |         |
             request  keep old surface

### 6.3 安全切分与摘要内容

压缩范围必须从较旧历史开始，并满足：

- 不切断 assistant tool call 与对应 tool result；
- 不覆盖受保护的 system/request head；
- 只替换当前 Surface 中连续、稳定的一段；
- 摘要必须明显小于被替换内容，否则视为失败；
- 最新若干消息原样保留，保证当前任务状态、用户最新约束和近期工具结果可直接看到。

摘要至少保留：

1. Project Goal / 当前任务；
2. 当前 Roadmap 与关键决策；
3. 已完成 Node、正在处理 Node、未完成 Node；
4. 关键 Resource / Mailbox 事实与引用；
5. 用户明确约束；
6. 已尝试的方法及失败原因；
7. 当前阻塞；
8. 下一步明确动作。

摘要不能把“推测”写成“事实”，也不能把被压缩历史中的旧计划自动提升为当前指令。

### 6.4 压缩失败与溢出恢复

- 摘要模型调用失败：保持原 Surface，不破坏 Session。
- 摘要结果没有缩小：拒绝替换，保持原 Surface。
- 已确认 provider context overflow：允许一次更激进的头部压缩并重试。
- 溢出恢复仍失败：停止当前 Turn，并由上层按照正常失败语义处理，不无限压缩 / 无限重试。
- 压缩事务必须具有明确的 start -> summary -> replacement -> end 关系；中途崩溃不能伪造成功。

这里直接借鉴 DeepSeek Harness 的核心思想：完整日志 + Surface 替换 + 平衡工具边界 + 压缩事务锁 + overflow recovery，但不机械复制其插件 API。

## 7. F11.0 验收标准

F11.0 只验收设计一致性，不运行代码：

- [x] manual / auto 的持久模式语义明确；
- [x] auto running / paused 生命周期明确；
- [x] 切换模式不打断当前 Turn；
- [x] 重启后 auto Project 默认暂停；
- [x] Main / Node 自动顺序与并发边界明确；
- [x] Node 正常结束与失败 / 取消 / 中断的处理分开；
- [x] Main Review 的四种结果明确；
- [x] 无 runnable Node 时不会静默卡死；
- [x] Node / Main Auto Run 默认回合上限明确；
- [x] 预算只计算实际进入的自动 Turn；
- [x] 失败不自动无限重试；
- [x] 高风险操作默认暂停，不自动授权；
- [x] 上下文压缩只改变 Surface，不删除原始日志；
- [x] 压缩触发、保留、切分、失败和 overflow recovery 明确；
- [x] 压缩摘要内容与验收条件明确。

## 8. 与 DeepSeek Harness 的借鉴与取舍

参考源码重点：

- goal-round-driver：借鉴“空闲后再排下一轮、精确 reservation / admission、Human 输入让自动任务让行、失败 / 取消不隐式重启、重启后默认不重新 armed”的生命周期思想。
- compaction-basic：借鉴“80% 压力阈值、近期尾部保留、旧历史替换为 checkpoint、工具配对边界、失败保持原 Surface、context-overflow 恢复”的机制。
- Auto Review：借鉴风险分级与 fail-closed 原则，但 F11 第一版不增加第二个 LLM Reviewer。

明确不采用：

- 不采用 DeepSeek Harness 默认 256 Round 作为 Navo 的 Project 上限；Navo 的预算按 Main / Node 两类自动 Turn 分开计算。
- 不采用“一个 goal round 无限消耗资源”的模型；Navo 用连续 Auto Run 的双预算先形成更明确的安全边界。
- 不把 Auto Review 作为 F11.0 的强依赖；高风险动作先暂停给 Human。
- 不把压缩事件本身塞进模型 Surface；压缩事实与原始历史均属于 Session 持久层。

## 9. 下一步最小开发顺序

严格按最小闭环推进，不提前把 F11.1–F11.5 一次性做完：

    F11.0 设计确认
       |
       v
    F11.1 Context Meter + Session Compaction
       |
       v
    F11.2 Auto Driver
       |       |
       |       +--> Main review / Node scheduling
       |
       v
    F11.3 Stop / Pause / Failure policy
       |
       v
    F11.4 Public Contract + Desktop
       |
       v
    F11.5 长程集成验收

实际开发时，F11.2 与 F11.3 可以在同一后端 Step 内共享少量内部状态，但不要为了追求并行开发而提前修改 Host / RPC 契约。第一优先级是先让 Session 压缩独立成立，再让 Auto Driver 消费这一能力。

## 10. 与现有 F10 的兼容边界

F11 不修改：

- F10.4a Node submit_completion 与 submitted 语义；
- F10.4b Main complete / rework / skip / ask Human 复盘语义；
- Node 每次完成只能由 Human / Main 确认的领域事实；
- 单一 AgentRuntime；
- SQLite 持久化与 Session 恢复；
- F10.3 中断 Turn 的收口语义。

F11 只新增“谁在什么时候自动发起下一次已存在的 Turn”以及“长会话如何压缩模型可见历史”两层能力。
