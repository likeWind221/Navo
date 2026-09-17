# 68：F9.5c Main Agent `write_roadmap`

## 目标

在 F9.5a / F9.5b 已建立 Roadmap 与 Node 读取能力之后，为 Main Agent 增加首次创建 Roadmap 的受控写入 capability。模型负责提出规划语义，Project 身份、Node 持久身份、DAG 校验与最终提交仍由确定性运行时掌握。

## 写入边界

```text
Main Agent proposal
    |
    | write_roadmap(reason, nodes[])
    v
ToolService
    |
    | trusted sessionId
    v
requireMainBinding
    |
    +--> current Project
    +--> Roadmap must be empty
    v
proposal-local keys
    |
    +--> generate persistent NodeId inside Navo
    +--> map goal / done_when to Node objective
    +--> resolve depends_on to Roadmap edges
    v
RoadmapStore.create
    |
    +--> prepare all new Nodes
    +--> validate Project ownership
    +--> validate references / duplicate edges / DAG cycles
    +--> project candidate Roadmap
    v
atomic commit
    |
    +--> Node batch
    +--> Roadmap history + snapshot
    v
Agent-visible Roadmap View
```

模型不能提交 `project_id`、Session 身份或持久 NodeId。`key` 只在一次提案中用于表达 `depends_on`，真正 NodeId 在可信 Tool 边界内生成。若图校验失败，`RoadmapStore.create` 在 Node batch commit 之前抛错，因此不会留下孤儿 Node 或半写入 Roadmap。

`write_roadmap` 只允许首次创建。当前 Project 已存在 Roadmap 时直接拒绝，不允许通过该工具覆盖；后续插入、删除、关系调整和 Node 定义变更归 F9.5d `modify_roadmap`。

## Agent-visible Node 语义

本 Step 同时将 Main Agent 可见的 work Node 字段从 `task` 收敛为：

```text
goal      = 要完成什么
done_when = 什么条件下认为完成
```

底层 Node domain 仍使用 `objective.description` / `acceptanceCriteria`，只在 Agent-facing projection 与 write proposal 中使用 `goal` / `done_when`，避免改动既有事件模型。

## 权限

`write_roadmap` 仅加入 Main Agent Profile，同时 Tool 本体再次执行 `requireMainBinding`。Node Agent 即使绕过 Profile 直接 dispatch 也会被拒绝。

```text
Main Agent  -> read_roadmap / read_node / write_roadmap
Node Agent  -> no Roadmap planning write capability
```

## 验证重点

- Main Agent 可以一次创建 work/control Nodes 与依赖关系。
- persistent NodeId 由 Navo 生成，而非模型控制。
- cycle 等非法 DAG 被拒绝，且无部分 Node / Roadmap 写入。
- 已存在 Roadmap 不能被 `write_roadmap` 替换。
- Node Session 无法直接调用 `write_roadmap`。
- Host / ordinary Node Profile 不暴露该工具。

## 当前边界

F9.5c 只解决“空 Roadmap -> 初始权威 Roadmap”。已有 Roadmap 的版本化修改、stale revision 防护、节点插入/删除/关系调整仍留给 F9.5d `modify_roadmap`。
