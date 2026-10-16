# F11.2：AutoRun 暂停、恢复与失败处理

## 1. 阶段定位

F11.1 已建立 AutoRun 的最小自动推进闭环：Node Turn → submit_completion → Main Review → 下一 Node。

F11.2 不新增新的 Agent Runtime，也不改变 ProjectRuntime、Roadmap 或 Node 的领域职责，而是在 AutoRun 控制面补齐可靠运行边界：

- Turn budget：Node 64、Main 32；
- Human pause / resume；
- failed / cancelled / interrupted / blocked 的明确停止语义；
- 预算耗尽后停止自动 Dispatch；
- 重启后不自动唤醒 Agent。

## 2. AutoRun 状态

首版 AutoRun 状态为：

```text
RUNNING
   │
   ├── 正常完成 ──→ COMPLETED
   │
   ├── Human pause
   ├── Turn failed / cancelled / interrupted / blocked
   ├── budget exhausted
   ├── busy / no runnable node
   └── review escalation / undecided
              │
              ▼
           PAUSED
              │
            Resume
              │
              ▼
        新的 AutoRun budget window
```

`COMPLETED` 只表示 Roadmap 已完成；其他自动停止均保留为 `PAUSED`，等待 Human 决定下一步。

## 3. Pause / Resume

### 3.1 Pause

Human 请求 Pause 时不直接 abort 当前 Agent Turn。

```text
Human Pause
    ↓
pauseRequested = true
    ↓
当前 Turn 正常收口
    ↓
PAUSED
```

如果当前没有执行中的 Turn，则立即进入 PAUSED。

这样可以避免在工具执行过程中强行中断造成部分副作用。

### 3.2 Resume

Resume 从当前 Project / Roadmap / Node 状态继续，但**重新建立一个连续 AutoRun budget window**。

因此：

- 新的 AutoRun 获得新的 `runId`；
- Node / Main 回合预算重新从 0 计数；
- 不复制或重置 Project、Node、Session、Roadmap 等领域事实；
- 当前 Roadmap 以 Resume 时的最新状态为准。

这与 F11.0 “预算按一次连续 AutoRun 计算、新的 AutoRun 重新计数”保持一致，也避免预算耗尽后 Resume 永远无法继续。

## 4. 回合预算

默认安全上限：

| 类型 | 上限 |
|---|---:|
| Node Auto Turn | 64 |
| Main Auto Turn | 32 |

计数只包含真正进入执行的自动 Turn。

达到上限后：

```text
当前 Turn 完成
      ↓
计数达到上限
      ↓
PAUSED
      ↓
不再自动 Dispatch 新 Turn
```

因此不会出现第 65 个 Node Turn 或第 33 个 Main Turn 被自动启动。

## 5. 失败分类

AutoRun 不对失败 Turn 做隐式自动重试：

| Turn 结果 | AutoRun 停止原因 |
|---|---|
| completed | 继续推进 |
| failed | `turn-failed` |
| failed + failure.code=interrupted | `turn-interrupted` |
| cancelled | `turn-cancelled` |
| blocked | `turn-blocked` |
| Main Review escalate | `review-escalated` |
| Review 无有效判定 | `review-undecided` |

其中 Main 的 `escalate` 是当前系统中明确的 Human 接管边界；未来若增加独立 `ask_human` 能力，应继续复用同一 PAUSED 语义，而不建立第二套 AutoRun 状态机。

## 6. 重启

AutoRun 运行态仍然只存在于进程内存：

```text
AutoRun RUNNING
      ↓
进程退出 / Host 重启
      ↓
Project / Node / Session 从 SQLite 恢复
      ↓
不存在旧 AutoRun runtime
      ↓
不会自动继续 Agent
      ↓
Human 显式重新 Start
```

因此 F11.2 不新增 AutoRun 持久化表，也不改变 F10 的 Session 中断恢复机制。

## 7. 修改范围

核心：

- `src/project/autorun.ts`
- `src/project/errors.ts`

测试：

- `tests/project/runtime/autorun.spec.ts`
- `tests/project/runtime/helpers.ts`（仅为 blocked 场景提供可控 AgentRuntime step limit）

文档：

- `_docs/102-devlog-f11-2-pause-resume.md`
- `_docs/backend-plan.md`
- `_docs/index.md`

明确不修改：

- ProjectRuntime
- AgentRuntime
- Node / NodeSession
- Roadmap
- SQLite 持久化结构
- Host / RPC / Electron

## 8. 验收矩阵

- [x] Human Pause 在 Turn 边界生效；
- [x] Pause 后可 Resume；
- [x] Resume 使用新的 AutoRun budget window；
- [x] Node 64 Turn 上限；
- [x] Main 32 Turn 上限；
- [x] failed 自动暂停且不重试；
- [x] cancelled 自动暂停；
- [x] interrupted 自动暂停；
- [x] blocked 自动暂停；
- [x] Main escalate / undecided 自动暂停；
- [x] 暂停状态保持单一 AutoRun 所有权；
- [x] AutoRun 不持久化运行态，重启不会自动执行。

代码已提交到 F11.2 专用分支；本机与 CI 验证结果待阶段验收后补入本文。
