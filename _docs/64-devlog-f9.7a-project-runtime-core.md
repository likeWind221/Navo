# 64：F9.7a ProjectRuntime Core

## 目标

F9.7a 建立 **Human-controlled Project execution boundary**：把“当前 Project 中这个 Node 是否允许由 Human 启动”收敛到一个薄的 ProjectRuntime，而不新增第二套 Node 状态机、不实现自动 Scheduler，也不改写 AgentRuntime。

## 最终控制流

```text
Human start Node
      |
      v
ProjectRuntime.startNode()
      |
      +-- Project exists / active?
      +-- Node belongs to Project?
      +-- work Node?
      +-- Node status == idle?
      +-- if Roadmap exists: Node still in current Roadmap?
      +-- no same-Node Human start already in flight?
      |
      v
NodeSessionService.start()
      |
      v
NodeTurnContextBuilder
      |
      v
single AgentRuntime
```

ProjectRuntime 不重新判断 `requiredBefore`。依赖满足后的 `locked -> idle` 已由 F9.3 的 RoadmapStore / Node event coordination 负责；F9.7a 直接把 NodeStore 当前状态视为权威事实，避免重新产生 Board-style 的第二套 readiness truth。

## 关键决策

### 1. ProjectRuntime 是控制入口，不是状态机

持久执行状态仍只有：

```text
locked / idle / working / completing / skipped
```

ProjectRuntime 不保存 `ready/running/waiting` 等领域状态。

唯一新增的是一个进程内 `startingNodes` reservation，用于封住如下同步竞态：

```text
Human Start #1 ----+
                   +--> NodeSession 尚未写入 work-started
Human Start #2 ----+
```

reservation 不是可恢复领域事实，只是调用互斥；Turn 完成、失败或取消后立即释放。

### 2. 当前 Roadmap membership 是 Project 级执行边界

若 Project 已经有 Roadmap，只有仍位于当前 Roadmap 的 Node 才能通过 ProjectRuntime 启动。

这是为了避免 Node 被 `remove_node` 从当前规划移除后，虽然历史对象仍存在且可能处于 idle，却又被新的 Project 执行入口误启动。

没有 Roadmap 的历史/独立 Node 继续保留原 NodeStore + NodeSession 能力，避免 F9.7a 破坏已有通用 Node 使用方式。

### 3. Human Gate 不被任何 Project 事实自动触发

ProjectRuntime 不监听：

- dependency completion；
- Mailbox message；
- Resource access change；
- Roadmap mutation。

这些事实最多让 Node 变成可启动状态，不会调用 `startNode()`。

```text
dependency/resource/message changed
            |
            v
        Project facts
            |
            X no auto-run
            |
       Human Start
            |
            v
      ProjectRuntime
```

## API

F9.7a 提供两个最小入口：

- `canStartNode(projectId, nodeId)`：只读派生判断，不产生事实；
- `startNode({ projectId, nodeId, text, signal? })`：Human-controlled start boundary。

真实 Turn 仍完全复用 `NodeSessionService -> AgentRuntime`。

## 验收覆盖

新增测试覆盖：

- idle Roadmap Node 不会自动运行，Human start 后才执行；
- 当前 Roadmap 外的 idle Node 被 ProjectRuntime 拒绝；
- 无 Roadmap 的独立 Node 保持兼容；
- archived Project、跨 Project Node、locked Node、control Node 被拒绝；
- 同一 Node 在首个 Human-started Turn 尚未结束时，第二次 Human start 不会隐式排队；
- 取消后 Node 回到现有 `idle` 状态，没有额外 ProjectRuntime 状态残留。

本 Step 通过仓库既有 GitHub Actions gate（`pnpm typecheck` + `pnpm test`）后才允许合入 master。

## F9.7a 边界

本 Step **不实现**：

- Main Session 的统一 Human start/stop；
- Node continuation message 的统一 Project 控制；
- cancel / failure / recovery 的完整 Project API；
- completion / skip 的统一 Human control façade；
- 自动调度、递归 Agent 唤醒或后台 Scheduler；
- Host / RPC / frontend contract。

这些继续由 F9.7b / F9.7c 收口。
