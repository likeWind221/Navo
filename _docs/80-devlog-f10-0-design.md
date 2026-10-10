# 80：F10.0 持久化与验证设计收口

> 状态：设计记录，2026-10-10 经用户确认（D2 位置、D4 损坏处理、D7/D9 验证语义按用户意见修订）。本 Step 不修改生产代码。

## 做了什么

只读盘点 Navo 当前内存状态与领域事件，并调研 DeepSeek Harness 的会话持久化、检查点与崩溃恢复源码，确定 F10.1–F10.6 的设计约束：持久化范围、写入成功的含义、重启恢复与中断处理规则、验证结论的含义与失效条件、验证者权限，以及验证结论与 Human 完成确认的关系。

### 现状盘点（2026-10-09 master）

| 状态所有者 | 内存结构 | 事实形态 | 已有可信重建入口 |
|---|---|---|---|
| `ProjectStore` | `Map<ProjectId, ProjectEvent[]>` | `project-created` / `project-goal-set` / `project-archived` / `project-reopened` | `restore(projectId, history)` |
| `NodeStore` | `Map<NodeId, NodeEvent[]>` | 11 种 Node 事件，revision = 事件序号 | `restore(nodeId, history)` |
| `RoadmapStore` | 历史 + 快照 Map | `roadmap-created` / `roadmap-changed`，带 `baseRevision` | `restore(projectId, events)` |
| `MailboxStore` | `Map<ProjectId, ProjectMessage[]>` | 每 Project 连续 `sequence` | `restore(projectId, history)` |
| `ResourceStore` | 历史 + 状态 + 顺序 Map | 4 种 Resource 事件，按 Project `sequence` | `restore(...)` |
| `WorkspaceStore` | `byProject` / `byRoot` | Project → 根目录绑定，**无事件** | 无 |
| `SessionStore` | 事件 Map + Surface Map | 11 种 Session 事件；Surface 由事件投影派生 | 无 |
| `ProjectRuntime` | `activeMains` / `activeNodes` + AbortController | 瞬时运行时事实 | 不适用 |

关键发现：

- 所有领域写入都是**同步**的“校验 → 写 Map → emit”。Roadmap 的 `create` / `change` 在一次调用里依次提交 Node 批次、Roadmap 历史和 `unlockReady` 产生的 Node 解锁，分三次写入不同 Store。因为全程同步，现在等价于原子提交；一旦改成异步落盘，就会出现中间状态。
- Workspace 绑定是唯一没有事件、只有 Map 的事实，重启后无法从其他事件推出。
- Surface 只依赖 Session 事件中的 surface op，可以从事件重放派生，不需要单独保存。
- 目标锁定（Roadmap 已存在时拒绝 `set_project_goal`）读取的是 RoadmapStore，因此恢复顺序必须保证 Roadmap 先于任何 Main Turn 恢复。用户对目标的“同意”只存在于 Main Session 消息中，属于 F10.2 范围。
- 运行环境：Node v24.14.0，根包 `engines.node >= 24`，内置 `node:sqlite` 可用。Host 由 Electron 44 以 `process.execPath` 子进程启动，Electron 自带 Node 版本对 `node:sqlite` 的支持需在 F10.1 实测。

## DeepSeek Harness 对照（只读，本机 `deepseek-harness/`）

| 源码 | 机制 | 采用 / 不采用 |
|---|---|---|
| `packages/session/session-persistence/src/index.ts`、`coordinator.ts` | 持久化单元就是现有 `SessionEvent` 日志，不另设存储消息类型；不变量：仅追加、连续 seq、无损 JSON、`append` 在批次持久后才返回 | **采用**：持久化单元就是现有领域事件；仅追加、连续 revision/sequence、可 JSON 序列化；返回成功即已持久 |
| 同上 `write-behind.ts` | 固定窗口批量写 + `session/flush` 屏障，被拒绝的写入保留事件暂停重试 | **不采用**：Harness 为流式高频事件优化。Navo 领域变更是低频的人机节奏，流式增量本来就不进入 Session 事件，逐次同步事务更简单，且天然满足下一行的检查点要求 |
| `packages/session/session-checkpoint-policy/src/index.ts` | 模型请求发出前、顶层工具正文执行前、每个步骤边界，必须先持久化；检查点失败则阻止执行 | **采用语义**：`llm-requested`、`tool-call-requested` 必须持久成功后才调用模型或执行工具；写入失败即回合失败。通过同步写穿透实现，不另建检查点插件 |
| `packages/core/session/src/repair.ts` | `interruptedTurnClosers`：保留中断尾部，不截断；为未结束的调用追加 `TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN` 错误结果，再补 step 结束和 interrupted 的 turn 结束；时间戳沿用最后一条真实事件 | **采用**：F10.3 的中断收尾完全按此形态，见 D6。**差异**：不新增 `interrupted` 结束状态，改用既有 `failed` + 错误码，避免修改公共事件契约 |
| `packages/session/session-persistence-sqlite/README.zh.md` | 单库保存所有会话；拒绝而不是迁移不属于自己的数据库 | **采用**：单一 SQLite 文件；schema 版本不匹配时拒绝启动 |
| `packages/storage/storage-domain/README.zh.md` | 读取取自内存权威状态，每次写入 resolve 前已持久，再发出变更事件 | **采用**：内存 Map 继续作为读模型；写入顺序为“落盘成功 → 更新 Map → emit” |
| `packages/util/atomic-write/` | 原子替换文件 + 跨进程写锁 | **不采用**：数据库事务已经提供原子性；Resource 实体文件仍由既有 Workspace 写入路径负责 |

## 关键决策

### D1 持久化范围

| 保存 | 所属子步骤 |
|---|---|
| Project 事件（含 `project-goal-set`、归档 / 重新打开） | F10.1 |
| Project → Workspace 根目录绑定（新增为持久事实，随 `project-created` 同一事务写入） | F10.1 |
| Node 事件、Roadmap 事件（含 `baseRevision` 与 reason） | F10.1 |
| Mailbox 消息、Resource 事件（元数据与 access） | F10.1 |
| Session 事件：消息、工具调用与结果、turn/step 边界、错误、上下文观察 | F10.2 |
| 中断收尾事件（由 D6 合成，与普通事件同一张表） | F10.3 |
| 验证结论 | F10.4 |

| 不保存 | 原因 |
|---|---|
| 流式文本 / 思考增量 | 不是领域事实；完成的 assistant 消息已经是事件 |
| Surface、Roadmap 快照、Resource 状态等投影 | 由事件重放派生；快照是以后可能需要的性能优化，不是事实 |
| `activeMains` / `activeNodes`、AbortController、follow 订阅 | 进程级瞬时状态，无法跨进程恢复 |
| 模型端点、API Key 等运行配置 | 仍由 Host 启动配置提供，不写入项目数据库 |
| Resource 实体内容 | 已在 Workspace 的 `.navo/assets` 等位置，数据库只保存元数据与 `entryRef` |

### D2 存储介质与位置

- **只用单一 SQLite 文件**，使用 Node 内置 `node:sqlite` 的同步驱动，不引入原生依赖。选型条件：单用户单机、只有一个 Host 进程写入；一次操作跨多个领域需要原子提交；不能给用户增加安装与运维负担。

| 选项 | 结论 | 理由 |
|---|---|---|
| SQLite | 采用 | 嵌入式零服务；支持跨表事务；WAL + `synchronous=FULL` 保证提交后断电不丢；单个本地用户的写入量远低于其上限 |
| MySQL | 不需要 | 解决多客户端、多用户经网络共享写入，Navo 没有此需求；需要用户安装并维护独立服务，不适合桌面应用。未来做云端协作或多设备同步时再评估服务端数据库 |
| Redis | 不需要 | 主要用于缓存与短期协调；Navo 读模型已是进程内 Map，再加缓存层没有收益；RDB/AOF 不提供跨领域关系事务，不适合作主存储 |
| 纯 JSONL | 不单独采用 | 适合“一会话一份日志”（Codex、Claude Code 的会话存储），但 Navo 一次变更跨多个领域，无法多文件原子提交 |

- 位置仿照 Codex（`~/.codex`）与 Claude Code（`~/.claude`），放在**用户主目录 `~/.navo/navo.db`**，可用环境变量 `NAVO_HOME` 覆盖（测试与真实模型验收使用）。数据归属用户而非某个前端外壳，Host 脱离 Electron 单独运行时也能读到同一份数据。
- 与 Project 工作目录下的 `<workspace>/.navo/` 区分：`~/.navo/` 保存全局状态（项目列表、各领域事件、会话、验证结论）；Workspace 的 `.navo/` 仍只保存该项目的 Resource 实体文件。
- 不采用“每 Project 一个库 + 全局索引”：项目列表必须在打开任何 Workspace 之前读出，跨 Project 的根目录唯一性需要全局事实源，两套库会形成可以各自修改的事实源。代价是 Project 目录拷贝到别处时不会带走项目历史。
- 表的形态（按领域分表，还是一张事件表加 `domain` 列）在 F10.1 决定，不在这里固定。约束是：事件以 JSON 文档保存原样结构；按 `(所有者 ID, revision/sequence)` 唯一，并在写入时强制连续。

### D3 写入成功的含义

> 一次公开写操作返回成功，当且仅当该操作产生的全部事件已在同一个已提交的 SQLite 事务中持久保存。

- 顺序：在内存中校验并生成事件草稿 → 开启一个事务写入**本次操作的全部事件** → 提交 → 更新内存 Map → emit。
- 事务失败（磁盘满、约束冲突、连续性冲突）时，内存不变、不 emit，调用方收到可序列化的持久化失败，不存在“内存成功但未落盘”的中间态。
- 一次 Roadmap 变更产生的 Node 批次、Roadmap 事件和 `unlockReady` 解锁必须合并成**同一个事务**。这是 F10.1 需要改造的地方：先把 unlock 计算并入提交前的批次，再一次性提交。
- 连接配置：WAL 加 `synchronous=FULL`，保证已提交事务在断电后仍然存在；事务使用 `BEGIN IMMEDIATE`，所有写入经过同一个存储所有者串行执行。
- Resource 写入顺序：先写实体文件，再提交元数据事件。事件提交失败只会留下无人引用的文件；反过来的顺序则会出现引用不存在的文件，所以禁止。
- 模型请求与工具执行之前的事件（`llm-requested`、`tool-call-requested`）也遵守 D3，写入失败即回合失败，不调用模型、不执行工具（对应 Harness checkpoint policy）。

### D4 重启恢复

- Host 启动时打开数据库并检查 schema 版本；数据库无法打开、版本未知或更高时拒绝启动并报告，不自动迁移。这一层失败意味着没有任何数据可信，继续运行可能写坏数据。
- 按依赖顺序重放：Project → Workspace 绑定 → Node → Roadmap → Mailbox → Resource → Session → 验证结论。全部经过各 Store 现有的可信 `restore` 入口，复用其校验。
- 重放过程不调用模型、不执行工具、不 emit 业务变更通知，也不产生任何新事件，唯一例外是 D6 的中断收尾。
- **单个 Project 的事件校验失败只隔离该 Project**：不加载进内存，原始数据保持不动，不截断、不自动修复；其他 Project 正常工作。该 Project 在列表中显示为“无法恢复”并附原因（领域、事件位置、错误码）。SQLite 事务不会留下半写记录，校验失败只可能来自程序缺陷或手工改库，影响范围应限制在出问题的 Project，而不是让整个桌面应用无法启动。
- 列表中的“无法恢复”状态属于公共契约变更，F10.1 实施时按共享契约流程单独提出，并交由前端计划展示。
- Workspace 根目录在重启后丢失或被移动时，Project 照常恢复，但在使用 Workspace 的位置返回 `workspace-unavailable`；不重新创建用户目录。
- Host 进入 ready 状态之前恢复必须全部完成，前端看到的第一份项目列表就是恢复后的状态。

### D5 恢复后的 Human Gate

- 恢复后不自动启动任何 Main、Node 或验证者回合，也不自动续跑中断的回合。
- 跨进程不保留 active Turn 事实：重启后所有 Project 都处于“没有 active Turn”的状态。

### D6 中断处理（F10.3）

在恢复阶段、Host ready 之前，对每个尾部未闭合的 Session 回合追加确定性的收尾事件，与该 Session 的普通事件一起在一个事务中提交：

1. assistant 消息中的工具调用如果没有对应的 `tool-call-requested`，补一条错误工具结果，错误码 `tool-not-started`。
2. 有 `tool-call-requested` 但没有结果的调用，补一条错误工具结果，错误码 `tool-outcome-unknown`，并说明工具可能已部分执行，**不会重试**。
3. 未闭合的 step 补 step 结束事件；回合补一条 `source: "runtime"`、错误码 `interrupted` 的错误事件，再补 `turn-ended { status: "failed" }`。
4. 时间戳沿用最后一条真实事件，序号接续，保证同一份日志总是得到相同的收尾结果。
5. 对应 Node 如果仍是 `working`，追加 `work-ended` 回到 `idle`，与 Session 收尾在同一事务中提交。

选择 `failed` + `interrupted` 错误码而不新增 `TurnEndStatus`：前端已经能展示 failed 和错误事件，不需要修改 `agent.turn.v2` 公共契约。如果以后需要在 UI 中把“中断”和“失败”区分开，再走共享契约流程。

### D7 验证结论的含义（F10.4）

**含义**：“通过”是独立只读验证者的**参考意见**——它判断目标 Node 当前版本满足目标与完成标准；“不通过”同理。结论只对“这个 Node、这个 revision、验证者实际检查过的内容”负责，不是真理证明，也**不是完成的前置条件**。是否完成始终只由 Human 决定（见 D9）。

验证结论是一条只追加的记录：

```
VerificationVerdict {
  id, projectId, nodeId,
  nodeRevision,                      // 验证时目标 Node 的 revision
  outcome: "pass" | "fail",
  reason,                            // 验证者提交时必填，由验证者自行归纳
  evidence?: EvidenceRef[],          // 可选，仅用于追溯
  verifierSessionId, timestamp
}
```

- 证据可选，可以引用 Resource、Workspace 文件路径或 Mailbox 消息，只用于让 Human 与 Main 追溯验证者看了什么；不要求“通过”必须带证据，避免为通过验证而额外登记资源。
- 结论本身不改变 Node 状态、不改变 revision、不启动任何 Agent。
- 只有 work Node 需要验证；control Node（人工开始 / 结束 / 确认）不需要。
- **当前有效结论**：目标 Node 最新的一条结论，且其 `nodeRevision` 等于 Node 当前 revision；否则为过期结论，只保留为历史。Node 的任何新工作都会产生 `work-started` / `work-ended` 使 revision 增加，因此新工作会自动让旧结论过期。
- 失效只看 Node revision，不追踪证据 Resource revision 或文件哈希：结论不拦截任何操作，过期只用于提示，按最简实现。

### D8 验证者的权限（F10.5）

- 复用同一个 AgentRuntime，新增只读、最小权限的 `verifier` Profile，不新增执行引擎。
- 每次验证使用一个**新的** Session，绑定 `(projectId, nodeId)`；不复用 Node 自己的 Session，避免执行者的上下文影响判断。
- 可见内容：目标 Node 的目标与完成标准、Project 目标、目标 Node 的 Mailbox 往来、Resource 读取（`project` / `shared` 访问范围，加上目标 Node 拥有的 `private` 资源）、Workspace 中 `.navo/` 以外文件的只读读取。
- 不可用：shell、edit、write、Resource 注册 / 修改 / 删除 / 改 access、Roadmap 修改、`send_to_main`、`set_project_goal`、网络工具。
- 唯一的写操作是 `submit_verdict`，只能针对被指定的 Node，一个验证回合最多提交一次。
- 验证回合同样只能由 Human 发起，受取消、失败释放和 D6 中断规则约束。验证回合**不**产生 `work-started`，不改变目标 Node 的 revision。
- 启动验证需要一个面向桌面的入口，属于公共契约变更，F10.5 实施时先停下来，按共享契约流程单独确认。

### D9 验证结论可见与失败重规划（F10.6）

- **不设完成门禁**：Human 确认完成与跳过都不受验证结论约束。即使没有结论、最新结论为“不通过”或已过期，用户仍可确认完成；界面最多提示当前结论状态。
- PRD 原则“执行结果不能由执行者自行宣布为完成”仍成立：Node 不能完成自己，验证者只提交意见、不能完成 Node，Main 没有完成权限。
- Main 通过 `read_node` 看到当前结论、是否过期和最近的历史结论（含理由与证据引用）。“不通过”时 Main 用既有 `modify_roadmap` 安排补救；结论不会自动触发 Main 回合。
- 前端交接：`project.node.review.v1` 现要求 `reason` 为非空文本（`rpc/project/validation.ts`）。“一键完成”无需修改契约，由前端按钮自动填默认理由（如“用户确认完成”）；由后续前端 Step 落实。

## 坑与发现

- “可重建”不等于“已持久”：现有 Store 的 `restore` 只证明给定历史能算出状态，F10.1 的验收必须真正关闭并重启 Host 进程后读回旧数据（沿用 [56](56-devlog-persistence-plan.md) 的约定）。
- 现有观察事件是在内存提交后才通知，订阅事件去写库会让“调用返回成功”早于落盘，违反 D3。持久化必须位于提交路径内，不能做成事件监听者。
- Workspace 绑定没有事件，是盘点中唯一会在重启后无法推出的事实，F10.1 需要补上。
- Harness 的中断收尾使用独立的 interrupted 状态；Navo 为不改公共契约选择了 failed + 错误码，这是有意的差异，见 D6。
- 初稿曾设计“没有当前有效的通过结论就拒绝完成”的门禁与“通过必须引用资源”的证据要求；用户审阅指出 Human Gate 才是最终决定，验证只应提供参考意见，两者均已撤销（D7、D9）。

## 用户确认结果（2026-10-10）

1. **D2**：只用 SQLite，位于 `~/.navo/navo.db`，可用 `NAVO_HOME` 覆盖。
2. **D4**：仅数据库 / schema 层失败拒绝启动；单个 Project 损坏只隔离该 Project。
3. **D7 / D9**：验证结论是参考意见，理由由验证者填写、证据可选、过期只看 Node revision；取消完成门禁，Human 一键即可完成。

## 明确不做

- 不修改生产代码、测试或前端；不选定表结构细节与 SQL。
- 不做数据库迁移框架、快照、多进程 / 多机共享写入。
- 不设计“Roadmap 生成后修改目标并重规划”（[76](76-devlog-f9.10-goal-confirm.md) 中记录的后续协调服务）。
- 不定义验证入口的公共 RPC 形态（F10.5 时按共享契约流程单独确认）。

## 下一步

F10.0 已确认。下一步开始 F10.1：Project 状态持久保存与重启恢复（先实测 Electron 44 自带 Node 的 `node:sqlite` 支持）。
