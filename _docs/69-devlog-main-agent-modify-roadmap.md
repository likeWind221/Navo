# 69：F9.5d Main Agent `modify_roadmap`

## 目标

在 F9.5c 已建立初始 Roadmap 创建能力之后，为 Main Agent 增加既有 Roadmap 的版本化修改 capability。Main Agent 可以提出新增节点、编辑未执行节点定义、调整依赖、重排与移除等规划变更，但不能绕过 Project / Node 版本、DAG 规则或人工完成/跳过边界。

## 主流程

```text
Main Agent
    |
    | read_roadmap -> base_version
    | read_node    -> node_version (edit_node only)
    v
modify_roadmap(action, exact versions, reason, ...)
    |
    v
trusted Main Binding
    |
    v
RoadmapStore.change
    |
    +--> exact Roadmap revision check
    +--> optional exact Node revision check
    +--> prepare new / edited Node events
    +--> apply one Roadmap action
    +--> rebuild and validate candidate DAG
    +--> protect already-working Nodes
    v
atomic commit
    |
    +--> Node batch
    +--> Roadmap event/history/snapshot
    v
new authoritative Roadmap version
```

参考 DeepSeek Harness `packages/goal/tool-goal/src/index.ts` 的 `get_goal -> update_goal(id, revision, action)` 形态，本 Step 采用“先读取精确版本、一次调用只执行一种 action”的模型侧协议。Navo 没有照搬 Harness 的 Goal lifecycle：这里的权威状态是 Project Roadmap DAG，因此实际校验与提交仍复用 `RoadmapStore.change` 和 Node event projection。

## 支持的规划 action

- `add_node`：创建一个新 work/control Node，可同时声明现有前置依赖；临时 `key` 只作为成功回执映射，不持久化。
- `edit_node`：修改现有 Node 定义与 required/optional；必须同时提供当前 Roadmap `base_version` 与 `read_node` 返回的 `node_version`。
- `connect` / `disconnect`：调整有向依赖边。
- `reorder`：修改 Roadmap 展示顺序，必须提供完整 Node ID 顺序。
- `remove_node`：从 Roadmap 路线中移除 Node，并同步移除其关联边；Node 历史事实本身保留。

每次工具调用只允许一个 action。多步重规划由 Main Agent 连续调用，每次使用上一轮成功结果返回的新 Roadmap version，避免把复杂异构 mutation 隐藏成难审计的一次模型写入。

## Node 定义修改边界

Node 定义修改新增正式 `definition-changed` Node event，而不是 Tool 直接覆写 Store 内存对象。work Node 的 `title / goal / done_when / requirement` 或 control Node 的 `title / control / requirement` 都通过事件投影重建。

```text
locked      -> editable
idle        -> editable
working     -> frozen
completing  -> frozen
skipped     -> frozen
```

同时禁止通过 edit 将 work Node 改成 control Node 或反向转换。一旦 Node 已进入执行或终态，若需要改变方向，应通过显式重规划（例如移除并新增新 Node），而不是静默改写正在执行工作的定义。

## 两级并发保护

普通 Roadmap 结构变更要求：

```text
base_version == current Roadmap revision
```

`edit_node` 额外要求：

```text
node_version == current Node revision
```

因此 Main Agent 即使读取了 Roadmap v3，只要目标 Node 在此期间独立变化到新 revision，旧 Node 定义也不能被覆盖。

## 原子性与权限

`RoadmapStore.change` 先在候选状态中准备 Node event、应用 Roadmap event、重建 DAG 并检查 working Node 不变量，全部通过后才提交 Node batch 与 Roadmap history。cycle、非法引用、stale version、Node 非可编辑状态等错误均不会产生部分提交。

`modify_roadmap` 只加入 Main Agent Profile，Tool 内仍执行 `requireMainBinding`。Node Agent 即使绕过 Profile 直接 dispatch 也会失败。

Node 的 `completion-confirmed` / `node-skipped` 仍保留原有人工确认语义。本 Step 没有把 `skip_node` 暴露给 Main Agent，因为当前 ToolExecutionContext 只有可信 Session 身份，没有可证明“这次操作来自直接人类确认”的 authority token。Main Agent 可以移除路线节点或重新规划，但不能伪装成人类将 Node 标记为 skipped。

## 验证重点

- `add_node` 连同依赖原子写入并返回 `key -> NodeId` 回执。
- stale Roadmap version 被拒绝且不改变 Node/Roadmap 状态。
- `edit_node` 同时推进 Node revision 与 Roadmap version。
- stale Node version 被拒绝。
- working Node 定义不可编辑。
- connect 形成 cycle 时完全不提交。
- reorder/remove 形成新的可重建权威 Roadmap。
- Node Session 无法直接调用 `modify_roadmap`。

## 当前边界

F9.5 完成后，Main Agent 已具备 `read_roadmap`、`read_node`、`write_roadmap`、`modify_roadmap` 的完整规划读写闭环。Node 报告、阻塞、跨节点协调请求与 Main Agent 后续响应仍属于 F9.6 Project Mailbox。
