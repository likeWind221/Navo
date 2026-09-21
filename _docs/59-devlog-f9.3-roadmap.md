# 59：F9.3 In-Memory Roadmap

## 结论

F9.3 已完成并收敛为一套以 **Node 事件状态 + Roadmap DAG** 为核心的内存路线图模型。Roadmap 负责“结构与版本”，Node 负责“执行状态与属性”；依赖满足会形成显式 `node-unlocked` / `node-locked` 事实，但不会自动启动 Agent。

本记录整合原 F9.3.1–F9.3.3 的图结构、设计复审、RoadmapStore、Board 尝试、状态模型复审与最终修复，作为 F9.3 的唯一权威实现记录。

## 最终模型

```text
Project
  |
  v
Roadmap
  +-- ordered NodeId[]
  +-- edges: A -> B
  +-- revision / history
  |
  +-----------------------------+
                                |
                                v
NodeStore                    Graph rules
  +-- required/optional         +-- DAG
  +-- work/control              +-- predecessors/successors
  +-- locked                    +-- requiredBefore
  +-- idle                      +-- topological order
  +-- working
  +-- completing
  +-- skipped
```

### Roadmap 与 Node 的职责

Roadmap 不复制 Node 目标、Session 或执行状态，只保存 Node 引用、展示顺序、依赖边、版本与变更历史。Node 的 `required | optional` 是 Node 属性，不属于路径、边或 Roadmap member。

Node 五态为：

```text
locked -> idle -> working -> idle
   \        \
    \        +--> completing
     +------------> skipped
```

- `locked / idle / working / completing / skipped` 都由 Node Event 重建。
- `completing` 与 `skipped` 都是人工确认后的终态，在依赖满足语义上等价。
- control Node 不进入 working，也不绑定 Agent Session。
- 自动解锁只会到 `idle`，不会自动执行、完成或跳过。

## 图结构与依赖语义

Roadmap 使用普通有向无环图表达串行、分叉和汇合，不引入 Fork/Path/Branch Group：

```text
      B
     / \
A --    -- F
     \ /
      D
```

一对多表示分叉，多对一表示汇合。普通嵌套分叉、交叉连接和独立节点都由 Node + Edge 表达。

`requiredBefore` 表示一个 Node 的全部必选祖先，而不是仅直接前驱。传播规则是：

- required Node 自身加入后继的必选祖先集合；
- optional Node 自身不加入，但继续向后传播它更上游的 required 祖先；
- 多个分支在汇合处取并集。

因此：

```text
A(required) -> B(optional) -> C(required)
```

C 不等待 B，但仍等待 A。

图构建执行引用、Project 归属、重复边、自依赖和 cycle 校验；Kahn 判环为 O(V+E)，必选祖先传播最坏可到 O(VE)，当前规模优先保持直接、可审计实现。

## RoadmapStore 与原子变更

RoadmapStore 提供创建、读取、变更、历史重建和地图查询。变更遵守“先候选、后提交”：

```text
change proposal
      |
      v
candidate Node events + candidate Roadmap
      |
      +--> validate Project ownership
      +--> validate references / DAG
      +--> validate Node state / revision
      +--> recompute dependency effects
      |
      v
single in-memory commit boundary
      |
      +--> Node histories
      +--> Roadmap history / snapshot
```

新 Node 创建、Node 属性变化、依赖变化以及由此产生的 lock/unlock 事件在同一内存批处理中预计算。任一校验失败都不能留下孤儿 Node、半条 Roadmap history 或部分状态变化。

这里保证的是**同进程同步内存提交的一致性**，不是数据库事务或崩溃恢复；持久化统一留给 F10。

## 状态联动与 Human Gate

依赖变化会落实为 Node Event，而不是额外维护一份 Board eligibility：

- complete / skip 后，扫描受影响后继；
- 所有 `requiredBefore` 均为 `completing | skipped` 时，locked Node 追加 `node-unlocked`；
- 路线修改导致 idle Node 不再满足依赖时，可追加 `node-locked`；
- working Node 的前提不能被破坏，危险路线修改直接拒绝；
- 手工 unlock 也经过依赖校验，不能作为绕过 DAG 的后门。

因此系统中没有“Node 是 idle，但 Board 又说不能执行”的第二套状态真相。

Human Gate 仍保持：

```text
dependency satisfied
       |
       v
      idle
       |
       X no auto-run
       |
Human explicit start
       |
       v
    working
```

## 地图查询

最终删除了早期 `Board`、`eligible/action/member`、`replace/replaced` 等额外投影状态。Roadmap 的只读查询只返回已提交事实：

- Project / Roadmap revision；
- Node ID、kind、required/optional、status、Node revision；
- Node 展示顺序；
- edges。

查询不产生新事件、不重新执行解锁，也不拥有第二套执行状态。前端后续可以基于这些事实绘制地图和统计，但真实执行权限仍由后端领域规则控制。

## 设计演进

F9.3 中途出现过两次重要修正：

1. **可选语义从 Path 回归 Node。** 初版曾设计 Fork/Path，并把 optional 绑定路径；最终删除该模型，以 Node 属性 + 普通边表达。
2. **Board 派生资格回归 Node Event 状态。** 初版 Board 曾维护 member/eligible 等投影，可能与 Node 状态产生双真相；最终删除 Board，把依赖变化落实为 lock/unlock 事件。

这些早期方案仅属于开发过程，不再作为当前架构入口。

## 验证

最终 F9.3 修复完成时：

```text
pnpm typecheck  PASS
pnpm test       PASS

51 test files
351 tests
```

覆盖 DAG、required/optional 祖先传播、分叉汇合、cycle 拒绝、控制节点、Node 五态、人工 complete/skip、路线批变更、原子失败、历史重建、自动 lock/unlock 与只读地图查询。

## 后续边界

- F9.4 在此基础上加入可信 Main / Node Binding；
- F9.5 将 Roadmap 读取和 mutation 以受限 Tool 暴露给 Main Agent；
- F9.7 才负责 Human-Controlled ProjectRuntime 的实际执行入口统一；
- F9.9 再定义前端/RPC 的公共地图契约；
- F10 实现 Project / Node / Roadmap 等领域状态的数据库持久化与启动恢复。
