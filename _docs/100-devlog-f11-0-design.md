# F11.0 自动化流程与自主运行架构设计收口

> 日期：2026-10-16  
> 状态：🔄 设计已落地，待用户确认  
> 范围：只收口 Phase 11 自动化流程；不修改生产代码。上下文压缩归入 Phase 12，RAG 归入 Phase 13。

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

Phase 11 的目标不是改变 Main / Node 的职责，而是增加一个**自动驱动层**：

~~~text
                 Human
                   │
             开启 / 暂停 / 接管
                   │
                   ▼
              Auto Driver
                   │
          ┌────────┼────────┐
          ▼        ▼        ▼
        Main     Node     Human
          │        │
          └────┬───┘
               ▼
          下一决策点
               │
               └──────→ 继续推进
~~~

核心问题只有一个：

> **一个 Agent Turn 结束后，在什么条件下由谁发起下一个 Turn？**

F11 不负责“记住更多历史”，也不负责“从历史知识库检索信息”；这些分别留给 F12、F13。

## 2. F11 的核心设计原则

1. **Human 显式开启自动化。** 新 Project 默认仍为人工模式。
2. **自动化不取消 Human Gate。** 正常低风险工作由系统连续推进；暂停、接管、高风险或无法判断时重新回到 Human。
3. **自动驱动不创建新的 Agent Runtime。** Main / Node 继续复用唯一的 AgentRuntime。
4. **Project / Roadmap / Node 是事实来源。** Auto Driver 只负责根据已有状态决定下一次 Turn。
5. **一个 Node 不允许并发执行多个 Turn；Main 同一时间最多一个 Turn。**
6. **失败默认停止自动推进。** 不对完整 Turn 无限自动重试。
7. **应用重启后不自动恢复运行。** 原本处于 auto 的 Project 必须等待 Human resume。

## 3. 人工 / 全自动模式

Project 的自动化语义分为两个维度：

| 状态 | 含义 |
|---|---|
| mode = manual | Human 决定每一次 Agent Turn 是否启动 |
| mode = auto | Project 允许 Auto Driver 在安全决策点继续推进 |
| autoState = running | 当前 Auto Run 获得执行许可 |
| autoState = paused | 当前 Auto Run 已停止，不得自动启动新 Turn |

推荐状态关系：

~~~text
                 Human switch
                      │
          ┌───────────▼───────────┐
          │                       │
       MANUAL ────────────────→ AUTO
          ▲                       │
          │                       ▼
          │                    PAUSED
          │                       │
          │                    resume
          │                       ▼
          └────────────── RUNNING
                              │
                         pause / stop
                              │
                              └──→ PAUSED
~~~

规则：

- manual → auto 不打断正在执行的 Turn；当前 Turn 收口后才进入自动决策。
- auto → manual 不打断当前 Turn；收口后停止自动启动。
- running → paused 禁止新的自动 Turn；正在执行的 Turn 默认自然收口。
- paused → running 必须由 Human 明确恢复。
- Project complete / archived 时自动运行强制停止。
- 应用重启后，mode = auto 的 Project 恢复为 paused，不自动唤醒 Agent。

## 4. Main / Node 自动推进顺序

每次 Turn 收口后进入一个新的 Decision Point：

~~~text
Decision Point
      │
      ├─ Project 非 active / Auto 非 running → STOP
      │
      ├─ Human Main 输入待处理 → Main Turn
      │
      ├─ Node 有待复盘结果 → Main Review Turn
      │
      ├─ 存在 eligible Node → Node Turn
      │
      ├─ Roadmap 未完成但无 eligible Node
      │       ↓
      │   Main Planning Turn
      │
      └─ 无法形成安全决策 → PAUSED + Human
~~~

Human 输入优先于自动任务；同一 Project 内 Main 同一时间最多一个 Turn。

### Node 的 eligible 条件

Node 必须同时满足：

- Project active；
- Node 为 idle；
- 必要依赖已满足；
- 不存在待确认 / 待复盘状态；
- 未被其他 Turn 占用；
- 属于当前 Roadmap；
- 首次执行，或最近一次 Main 复盘明确要求返工。

多个互不冲突的 Node 可以并行，但同一个 Node 永远不并发。多个 Node 完成后的 Main Review 按完成事件进入 Project 的顺序逐个处理。

### Node → Main Review

正常结束的 Node Turn，即使没有提交完成信号，也进入 Main Review；“没有完成信号”不等于失败。

Main Review 必须给出：

- complete
- rework
- skip
- ask_human

其中：

- complete：沿用 F10.4b 的完成判定与下游解锁；
- rework：Node 返回可执行状态并携带返工意见；
- skip：沿用现有跳过语义；
- ask_human：立即暂停自动推进。

Main 可以修改下游 Roadmap，但不能越权把尚未执行的 Node 判定为完成。

## 5. 没有可运行 Node 时的处理

不能因为当前没有 eligible Node 就静默等待。

~~~text
No eligible Node
      │
      ▼
Main Planning Turn
      │
      ├─ 形成新的合法路线 → 重新进入调度
      │
      └─ 仍无法继续 → PAUSED + Human
~~~

这样可以把“暂时没有可执行节点”和“系统已经无法继续”区分开，避免自动流程产生隐性死锁。

## 6. 回合预算

预算按**一次连续 Auto Run**计算，而不是 Project 生命周期累计：

| 预算 | 首版默认值 | 计数对象 |
|---|---:|---|
| Node Auto Turns | 64 | 实际进入执行的自动 Node Turn |
| Main Auto Turns | 32 | 实际进入执行的自动 Main Turn |

规则：

- 排队后因暂停、模式切换、竞态而未真正进入 Turn，不计数；
- Human 主动发起的 Turn 不计入 Auto Run 预算；
- 任一预算达到上限，自动状态变为 paused，原因记录为 turn-limit；
- Human resume 后重新建立预算；
- F10 已有的单 Turn maxSteps = 150 和模型级 transient retry 继续有效，F11 不重复定义。

64 / 32 是首版安全上限，不作为最终性能结论；后续根据长程验收数据调整。

## 7. 失败、取消与中断

| 情况 | 当前 Turn | 是否继续自动推进 |
|---|---|---|
| Node 正常结束 | 正常收口 | 进入 Main Review |
| Node failed | 收口 | 否，暂停 |
| Node cancelled | 收口 | 否，暂停 |
| Node interrupted | 收口为 interrupted | 否，暂停 |
| Main Review failed | 收口 | 否，暂停 |
| Main cancelled / interrupted | 收口 | 否，暂停 |
| Main ask_human | 收口 | 否，暂停 |
| Auto Run 达到预算 | 收口 | 否，暂停 |

F11 不允许：

- 完整 Turn 失败后无限自动重跑；
- 因旧调度事件重新启动已经取消的 Turn；
- 在应用重启后隐式恢复 Auto Run。

Human resume 后，失败 Node 是否重新执行仍遵循现有 Node 生命周期和 Main / Human 的决定，而不是由失败处理逻辑隐式重试。

## 8. 高风险操作与 Human 接管

自动模式只自动执行当前权限模型允许的普通项目工作。

以下情况默认暂停：

- 删除或覆盖 Project 外数据；
- 对外发布、发送或提交不可逆变更；
- 访问或传输 Secret / Token / 凭据；
- 修改权限、安全策略或执行策略；
- 可能造成系统级或不可逆副作用的操作；
- Main 无法确认目标、范围或影响边界。

~~~text
Auto Tool
   │
   ▼
Risk / Boundary Check
   ├── normal → execute
   │
   └── high / ambiguous
             ↓
          PAUSED
             ↓
           Human
~~~

F11.0 第一版不引入额外 LLM Reviewer；先利用现有权限边界 + Human Gate 建立 fail-closed 自动化流程。

## 9. F11.0 验收标准

F11.0 只验收设计，不运行代码：

- [x] manual / auto 语义明确；
- [x] running / paused 生命周期明确；
- [x] 模式切换不打断当前 Turn；
- [x] 重启后 Auto Project 不自动运行；
- [x] Main / Node 自动推进优先级明确；
- [x] Node eligible 条件与并发边界明确；
- [x] Node 正常结束、失败、取消、中断分别处理；
- [x] Main Review 的四种结果明确；
- [x] 无 eligible Node 时不会静默卡死；
- [x] Node / Main Auto Run 预算明确；
- [x] 失败不无限自动重试；
- [x] 高风险操作回到 Human Gate；
- [x] F11 与 F12 / F13 的职责边界明确。

## 10. 下一步开发顺序

F11 后续只围绕自动化流程推进：

~~~text
F11.0 设计确认
       ↓
F11.1 Auto Driver 最小闭环
       ↓
F11.2 Pause / Resume / Failure
       ↓
F11.3 Public Contract / Desktop
       ↓
F11.4 长程自动化验收
~~~

**F12 再单独实现 Context Meter + Session Compaction；F13 再实现 RAG。**

F11 的完成标准是：在不破坏 F10 Human Gate、Project / Roadmap / Main / Node 领域语义的前提下，Navo 可以由 Human 显式开启自动模式，并安全地连续推进一个多 Node Project，直到完成或明确回到 Human。
