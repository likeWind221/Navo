# 70：F9.5 Main Agent Planning

## 结论

F9.5 已完成 Main Agent 的 Roadmap 规划闭环：模型可以读取当前 Project 事实、创建初始 Roadmap、对已有 Roadmap 做版本化增量修改，但最终写入仍由可信 Binding、RoadmapStore 和 Node 领域规则决定。

本记录整合原 F9.5a–F9.5d 的 `read_roadmap`、`read_node`、`write_roadmap`、`modify_roadmap` 四份开发记录，作为 F9.5 的唯一权威实现记录。

## 完整规划闭环

```text
                   Main Agent
                       |
          +------------+------------+
          |                         |
          v                         v
   read_roadmap                 read_node
          |                         |
          +------------+------------+
                       |
                       v
               current Project facts
                       |
          +------------+------------+
          |                         |
          v                         v
   write_roadmap              modify_roadmap
          |                         |
          +------------+------------+
                       |
                       v
              trusted Main Binding
                       |
                       v
                  RoadmapStore
                       |
        version / DAG / Node validation
                       |
                       v
             authoritative Project facts
```

Main Agent 获得的是“规划 capability”，不是任意 Project/Node 写权限。

## 读取能力

### read_roadmap

`read_roadmap()` 从可信 Main Session Binding 推导 Project，不接受模型提交 `project_id`。

模型可见视图只包含 Roadmap version、依赖、Node ID、标题、required、status、`depends_on`、goal 与 done_when 等规划信息；Node 私有 `sessionId`、confirmation 等执行信息不暴露。

空 Roadmap 是正常状态，而不是错误。

### read_node

`read_node(node_id)` 用于读取一个具体 Node 的定义和精确 revision。NodeId 只是“选择哪个对象”的引用，不构成授权：

```text
model node_id
    |
trusted Main Binding
    |
node.projectId == binding.projectId ?
    |
    +-- yes --> Agent-visible Node view
    +-- no  --> current Project 中不存在
```

跨 Project Node 和不存在 Node 对模型采用一致的拒绝边界，避免利用 NodeId 探测其他 Project。

## 初始 Roadmap 创建

`write_roadmap` 只允许在当前 Project 尚无 Roadmap 时创建初始规划。

模型提交 proposal-local `key` 表达节点间依赖，Navo 在可信边界内生成真正的持久 NodeId：

```text
LLM proposal
  nodes: [research, build]
  build.depends_on = [research]
        |
        v
proposal-local keys
        |
        v
Navo generate NodeId
        |
        v
candidate DAG validation
        |
        v
atomic Node + Roadmap commit
```

成功后返回 `key -> NodeId` receipt。cycle、非法引用等校验失败时，不留下孤儿 Node 或半写入 Roadmap。

已有 Roadmap 不能被 `write_roadmap` 覆盖，后续变化必须走 `modify_roadmap`。

## 增量 Roadmap 修改

`modify_roadmap` 每次只执行一种 action：

- `add_node`
- `edit_node`
- `connect`
- `disconnect`
- `reorder`
- `remove_node`

一次只做一个 action 的目的，是让多步重规划保持可审计，并让每一步都基于上一轮成功结果返回的新 revision。

### 两级版本保护

普通 Roadmap mutation 要求：

```text
base_version == current Roadmap revision
```

`edit_node` 还要求：

```text
node_version == current Node revision
```

因此即使 Roadmap version 没变化，只要目标 Node 在其他路径中已更新，旧 Node view 也不能覆盖新定义。

### Node 定义修改

Node 定义变化通过正式 `definition-changed` Event 记录，而不是 Tool 直接改内存对象。

仅：

```text
locked / idle -> editable
working / completing / skipped -> frozen
```

且 work/control 类型不能互相转换。若一个 Node 已经进入执行或终态，需要通过重规划新增/移除 Node，而不是静默篡改历史定义。

### remove_node 与 skip 的区别

`remove_node` 表示把 Node 从当前路线规划中移除：

```text
Roadmap no longer references Node
!=
Node was human-confirmed skipped
```

Node 历史仍保留。Main Agent 没有 `skip_node` 或 completion confirmation 权限。

## 权限与安全边界

F9.5 采用两层防线：

```text
Profile allowlist
      |
      v
model sees capability
      |
      v
Tool execute
      |
requireMainBinding()
      |
      v
domain validation
```

因此即使 Node Session 绕过 Profile 直接 dispatch Roadmap Tool，也会因为真实 Session Binding 被拒绝。

关键不变量包括：

- Project 身份来自 trusted Main Session，而非模型参数；
- stale Roadmap / Node revision 被拒绝；
- 非法引用、重复关系和 cycle 被拒绝；
- working Node 定义不可编辑；
- 候选 Node Event + Roadmap change 全部校验后再提交；
- Main / Node 始终复用同一个 `AgentRuntime`；
- Main 不能确认 Node completion / skip。

## Agent-facing 语义

F9.5 将模型侧 work Node 描述统一为：

```text
goal      = 要完成什么
done_when = 什么条件下认为完成
```

底层 Node Domain 仍使用 `objective.description` / `acceptanceCriteria`，Agent-facing DTO 不要求重写领域事件模型。

## 验证

F9.5a–F9.5d 均通过独立 PR 合入 master。测试重点包括：

- Main 可以读取 Roadmap / Node，但看不到私有 Session/confirmation；
- Node Session 不能调用 Main-only Roadmap capability；
- 初始 Roadmap 创建返回 key-to-NodeId receipt；
- cycle / 非法 proposal 不产生部分提交；
- stale Roadmap version 被拒绝；
- stale Node version 被拒绝；
- working Node 不可编辑；
- connect cycle 完全回滚；
- reorder / remove 后 Roadmap 可稳定重建。

最终 F9.5d GitHub Windows CI 通过 `pnpm typecheck` 与全量 `pnpm test`。

## 与后续 Step 的边界

F9.5 只解决 **Main 如何规划和修改 Roadmap**。

它不解决：

- Node 如何向 Main 报告结果或阻塞；
- Resource 如何跨 Node 交接；
- Resource 到位后 Node 如何获得上下文；
- Node 是否自动执行。

这些由 F9.6 Workspace / Resource Handoff 与 F9.7 Human-Controlled ProjectRuntime 继续处理。
