# 78：F10.0 持久化与验证设计收口

本记录合并整理前编号为 69（F10 初始规划）与 80（F10.0 设计收口及后续修订）的两篇记录；初始规划放在文末附录。

> 状态：设计记录，2026-10-10 经用户确认（D2 位置、D4 损坏处理、D7/D9 验证语义按用户意见修订）。2026-10-15 经用户决定撤销 D7–D9 的独立验证者设计，改由 Main 判断完成，见 D10；同日补充完成信号、复盘判定与两种推进模式，见文末 D11。同日为修复 BUG-010 删除控制节点，见 D12。本 Step 不修改生产代码。

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

> 已于 2026-10-15 撤销，由 D10 取代；以下保留原设计作为历史。

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

> 已于 2026-10-15 撤销，由 D10 取代；以下保留原设计作为历史。

- 复用同一个 AgentRuntime，新增只读、最小权限的 `verifier` Profile，不新增执行引擎。
- 每次验证使用一个**新的** Session，绑定 `(projectId, nodeId)`；不复用 Node 自己的 Session，避免执行者的上下文影响判断。
- 可见内容：目标 Node 的目标与完成标准、Project 目标、目标 Node 的 Mailbox 往来、Resource 读取（`project` / `shared` 访问范围，加上目标 Node 拥有的 `private` 资源）、Workspace 中 `.navo/` 以外文件的只读读取。
- 不可用：shell、edit、write、Resource 注册 / 修改 / 删除 / 改 access、Roadmap 修改、`send_to_main`、`set_project_goal`、网络工具。
- 唯一的写操作是 `submit_verdict`，只能针对被指定的 Node，一个验证回合最多提交一次。
- 验证回合同样只能由 Human 发起，受取消、失败释放和 D6 中断规则约束。验证回合**不**产生 `work-started`，不改变目标 Node 的 revision。
- 启动验证需要一个面向桌面的入口，属于公共契约变更，F10.5 实施时先停下来，按共享契约流程单独确认。

### D9 验证结论可见与失败重规划（F10.6）

> 已于 2026-10-15 撤销，由 D10 取代；以下保留原设计作为历史。

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
- 不设计“Roadmap 生成后修改目标并重规划”（[74](74-devlog-f9.10-goal-confirm.md) 中记录的后续协调服务）。
- 不定义验证入口的公共 RPC 形态（F10.5 时按共享契约流程单独确认）。该条随 D10 失效：Main 判断完成不需要新的公共入口。

## 修订（2026-10-15）：撤销独立验证者，改由 Main 判断完成

### 撤销原因

- PRD 的 Verification 源自自动循环：没有人看结果，执行者自称完成又不可信，需要独立角色判断。Phase 9 加入 Human Gate 后，原则“执行结果不能由执行者自行宣布为完成”已由人工确认满足。
- D9 取消完成门禁后，验证结论既不挡在完成前，也不能自动接上 Main 重规划，只剩一个独立的“验证”按钮：用户要先验证、读结论、再启动 Main，同一意图拆成两次操作，且用户本来就会查看 Node 成果。
- 独立验证者带来新的 Profile、Session、RPC 入口和结论存储，收益只是一份可被忽略的参考意见。

### D10 Main 判断完成（F10.4）

- 完成判断的归属：Human 与 Main 都可以完成 work 节点；Node 不能完成自己。PRD 原则 2 仍成立：Main 是协调者而不是该节点的执行者。
- Main 只在 Human 启动的 Main 回合中判断，读取节点目标、完成标准、可见 Resource 与 Mailbox 往来（复用 `read_node`、Resource 读取），判断通过时以自己的理由与检查过的节点 revision 完成节点。
- 复用既有完成事实：`completion-confirmed` 已带 `confirmedBy`、`reason`、`reviewedRevision`，Main 完成写入 `confirmedBy: "main"`；不新增结论存储，持久化与恢复沿用 F10.1b 的 Node 事件。公共契约中 `confirmedBy` 已是文本字段，前端区分“Human / Main 完成”无需改契约，由前端计划另行展示。
- 判断不通过时不产生完成记录：Main 把返工意见发给该节点，节点下一次回合开始时看到发给自己的意见；任务范围真的改变时仍用 `modify_roadmap`。Human 再决定是否启动该节点。
- 返工意见复用 F9.6a 已有、但尚无生产调用方的 Main->Node Mailbox 路由（`postFromMain`），持久化沿用 F10.1c；F10.4 需要补上 Main 的发送工具与 Node 回合开始时的读取。为避免 F9.6 担心的“两份任务事实”，约定返工意见只是意见，节点的权威任务仍是目标与完成标准，意见不修改二者。返工意见在桌面的展示按共享契约流程另行提出。
- 边界：Main 不能跳过节点（是否放弃可选工作属于用户的范围决定）；完成后不能撤销，误判通过 Roadmap 插入补救节点处理；Main 完成节点后下游解锁，但不自动启动任何 Agent。
- 对文末附录（原 69）中“Main 验证等于规划者给自己打分”的顾虑：Main 判断的是 Node 成果是否满足其完成标准，而不是计划本身是否正确；上下文压力在 F10.4 实施与真实模型验收中观察，确有问题再考虑独立检查。
- 全自动推进放在 F11（2026-10-15 用户确认）：由代码中的驱动循环在 Node 回合结束后启动 Main 审查回合，Main 决定完成、发返工意见、修改 Roadmap 或暂停求助，驱动按决定启动返工的 Node 或下一个已解锁的 Node；Main 不在自己的回合内同步调用 Node。停止条件与预算、暂停求助、高风险操作把关、Main 自评缺少人工兜底的风险，以及上下文压缩，都在 F11.0 设计收口。F10.4 的完成判断与返工反馈按 F11 可复用的形态实现。
- F10.4 开始前仍需只读检查 DeepSeek Harness 中与完成判断、工具权限相关的源码，在步骤介绍中说明采用与不采用的机制。

## 修订（2026-10-15）：完成信号、复盘判定与两种推进模式

### 修订原因

- 讨论 F10.4 时核对现状：`modify_roadmap` 已能在项目中途增删改节点、调整依赖，但已有离线与真实验收都由用户在指令中写明具体改法，尚未验证 Main 能从 Node 成果自行推断计划调整；Main 提示也没有要求看完成果后重估下游。
- Node 回合以 `completed` 结束只说明模型停止调用工具，可能是在提问、汇报进度或只做了一半。人工模式有人查看回复，全自动模式没有人回答，需要一个由系统识别的完成信号。
- 用户确定人工与全自动两种推进模式共用同一条“完成信号 -> 确认 -> 复盘 -> 计划反馈”流程，区别只在节点启动、完成确认与跳过由谁把控。

### D11 完成信号、复盘判定与推进模式

本节取代 D10 中“Main 只在 Human 启动的回合中判断”“Main 不能跳过节点”与“全自动推进中每次启动都来自 Main 决定”三条；D10 的其余约定（完成归属、复用 `completion-confirmed`、返工意见经 Mailbox 送达且不修改目标与完成标准、完成不可撤销）继续有效。

**完成信号与待确认（F10.4a）**

- Node 认为任务完成时显式发出完成信号，附成果摘要、产物 Resource、逐条对照 `done_when` 的满足情况与未完成事项；发出后本回合结束。自查只是复盘材料，不代表完成。
- 节点进入“待确认”：不能再被启动，下游不解锁。Node 不能把自己标记为完成。
- 待确认节点由确认方处理：确认完成（下游解锁）、发返工意见（回到 idle，下一回合看到意见）或跳过。人工模式下确认方是 Human，并提示“Node 认为已完成”；全自动模式下是钩子触发的 Main 复盘。
- 不采用“全自动模式下 Node 自行标记完成、Main 事后复盘”：完成会立即解锁下游且不可撤销，全自动调度会让下游基于未检查的成果开始执行，也违背“执行者不能自行宣布完成”。由 Main 在同一复盘回合先判定再调整计划，不增加回合数。

**Main 复盘判定（F10.4b）**

- 复盘输入是系统从已保存事实生成的回合报告：节点与版本、回合结局、是否发出完成信号、Node 最后一条回复、本回合登记或更新的 Resource、本回合发给 Main 的消息。报告不依赖 Node 是否调用 `send_to_main`，也不暴露 Node 私有 Session 的其余内容。
- 每个复盘回合必须且只能给出一次判定：完成、返工意见、跳过或交给 Human；判定只认复盘时的节点版本。判定前后可在同一回合用 `modify_roadmap` 调整下游。
- Main 可以跳过节点（可选或必需），须写明理由；跳过会导致计划大幅改变时应改为交给 Human（用户 2026-10-15 决定）。
- 每次判定留下复盘记录并随 Project 保存，用于识别哪些回合已复盘；复盘记录是新增的判定事实，完成仍沿用 `completion-confirmed`。“待复盘”定义为已结束且尚无复盘记录的 Node 回合，由已保存事实推出，不另设队列，重启后不丢失、不重复。
- 同一节点返工意见上限 2 次，超过后只能交给 Human。
- 人工模式下节点结束后不自动复盘，提供“请 Main 复盘”的可选入口（按钮或提示）；复盘回合与判定与全自动模式相同，交给 Human 只在回复中说明，不触发暂停。

**两种推进模式（F11，作为 F11.0 已确认输入）**

- 模式属于 Project，取值人工 / 全自动，默认人工；切换作为 Project 事实持久保存，只有 Human 能切换，在下一个决策点生效，不打断进行中的回合。参考 DeepSeek Harness `packages/interaction/permission-presets/src/index.ts`：当前预设以 `permission/preset` Session 事件记录并投影，仅经命令或 UI 切换；其 `auto` 预设以自动审批代替人工、放行不了时退回人工。Navo 采用“模式为持久事件、只由人切换、自动不等于无限制而是可退回人工”，不采用其 sandbox / approval 组合与自定义预设。
- 两种模式下目标确认与初始 Roadmap 都须 Human 同意（F9.10），Main 不能修改项目目标，项目整体完成由 Human 确认。
- 全自动模式的推进：依赖已满足、状态为 idle、没有待确认或待复盘回合，且从未执行过或最近一次判定为返工的节点都会启动，可并行（用户 2026-10-15 决定按 Roadmap 依赖推进）；Node 回合结束后钩子触发 Main 复盘，复盘按 FIFO 串行，Human 在 Main 会话中的消息优先，同一 Main 或 Node 不并发执行。
- 回合结束分类：发出完成信号进入待确认并复盘；正常停止但未发信号（提问、阻塞、到达步数或 token 上限）同样经钩子交给 Main 复盘，报告标明“未发出完成信号”，由 Main 发返工意见、重规划、跳过或交给 Human；失败、取消与中断不复盘，直接自动暂停。人工模式下对未发信号的回合不做任何自动处理。
- 自动暂停：Main 交给 Human、复盘回合未给出判定、返工超限、回合数超限、回合失败或中断、需要修改项目目标时进入“自动暂停”，记录原因，模式仍为全自动；Human 处理后继续，或切回人工。Main 与 Node 各有回合数上限，从切到全自动或继续时开始计数（用户 2026-10-15 决定）。
- 重启：原为全自动的 Project 重启后进入自动暂停，不自动续跑，与 F10.3 一致；原为人工的保持人工。
- 待确认状态、复盘入口、模式切换与暂停原因需要桌面展示，F10.4a 与 F11.4 开始前分别按共享契约流程确认，前端展示交由前端计划。

## 修订（2026-10-15）：删除控制节点（BUG-010）

### 修订原因

- BUG-010：`create_roadmap` / `modify_roadmap` 的 Node 参数同时含只对 work 或只对 control 合法的字段，模型（gpt-6-luna、gpt-6-sol）按公布的扁平 Schema 发送跨分支字段，运行时拒绝；gpt-6-sol 连续 15 次被拒仍未自行删掉 `control`。
- start / end 控制节点只起展示作用；required checkpoint 实际是人工关卡，但 F10.4 起每个 Node 都要由 Human 或 Main 确认后才解锁后继，人工关卡已由普通 Node 覆盖。
- 用户决定：从 Navo 中整体删除控制节点概念，从根上去掉条件字段，而不是在 Schema 上继续拆分分支（[95](95-bugfix-bug-010-roadmap-schema.md) 中尝试过的 `work_nodes` + `checkpoints` 方案已回退）。

### D12 只有一种 Node

- 每个 Roadmap Node 都是工作单元：标题、目标、完成标准、必选 / 可选。`create_roadmap` 的 `nodes[]` 与 `modify_roadmap` 的 `add_node` / `edit_node` 只有这一种扁平形状，字段全部必填（`index` 除外），`kind` / `control` 由结构校验直接拒绝。
- 公开 `NodeV1` 去掉 `kind` / `controlPurpose`；Node 领域模型、创建输入与新事件不再产生控制节点。
- 旧数据兼容（方案 A，用户选择）：已存数据库中的 `control-created` 历史与引用它们的 Roadmap 事件不改写。转换只在读取已保存历史的边界做一次：恢复计划识别首个事件为 `control-created` 的 Node 历史，整段丢弃（其后的确认、跳过、改定义等事件随之丢弃），并把这些 ID 交给 Roadmap 重放；Roadmap 重放到最后一个引用旧控制节点的事件为止都在原始结构上进行，随后把 `前驱 -> 控制节点 -> 后继` 旁路成 `前驱 -> 后继`（去重，跨连续控制节点传递），之后的事件在旁路后的结构上重放。之后新写入的事件不会再引用控制节点，因此分界点在每次重启时保持不变。
- 旁路后，原本被 required 控制节点挡住、但依赖已满足的锁定 Node 会在启动时自动解锁并写入 `node-unlocked`，否则旧 Project 会卡在无法启动的状态；只对引用过旧控制节点的活跃 Project 执行。
- 边界：分界点之后、升级之前写入的旧事件按旁路后的结构重放，插入位置可能与原展示顺序略有差异；若这类旧事件恰好重复连接一条已由旁路产生的边，该 Project 会作为损坏隔离。启动解锁不区分锁定原因：旧 Project 中依赖已满足但曾被人工锁定的 Node 也会被解锁。

## 下一步

F10.0 已确认，F10.1–F10.3 与 F10.4a 已完成。F10.4a 实施时经用户确认，返工意见改存于 Node 事件（`rework-requested`）而非 D10 所述的 Main->Node Mailbox，原因见 [96](96-devlog-f10-4a-done-signal.md)。F10.4b 已完成生产实现与离线测试（[97](97-devlog-f10-4b-main-review.md)），实施时把“系统整理回合报告”改为“Main 按需核查”：精简清单作线索，产物与过程由 Main 按需读取；真实模型验收待用户同意。

## 附录：F10 初始规划（原 69）

### 做了什么

按用户决定，将 Evidence / Verification 闭环纳入 F10，与原定的数据库持久化、重启恢复和中断处理合并为“可恢复、可验证的长期 Project”阶段，并在 [后端计划](backend-plan.md) 第 8 节写入 F10.0–F10.7。本次仅调整计划，验证功能暂时搁置，不实施代码，也未开 F9.10。

### 关键决策

- **不追加 F9.10。** 原计划在 Phase 9 关键边界中明确不实现 Verifier；Phase 9 尚有 F9.8 真实验收未收口（BUG-001 至 BUG-004）和 F9.9 暂停。验证闭环解决不了这些 Bug，带着它们做验证，真实验收仍会卡在同一位置。
- **F10 合并持久化与验证。** PRD 的 Phase 10 是 Evidence + Verification，后端计划原 F10 是持久化、验证“后续待排期”，两者不一致。合并后 F10 同时覆盖两者，按用户要求统一到 F10。
- **先持久化、后验证。** 沿用 [56：内存与持久化阶段划分](56-devlog-persistence-plan.md) 的顺序：验证结论从第一天起就随 Project 一起保存与恢复，避免先做内存版再迁移。若需要更早演示验证闭环，可在 F10.0 设计时再评估调换顺序。
- **独立验证者的理由。** PRD 原则“规划、执行与验证分离，执行结果不能由执行者自行宣布为完成”。Node 自验违反该原则；Main 验证等于规划者给自己的计划打分且加重 Main 上下文；只靠人工确认没有可供重规划的结构化结论。验证者复用同一 AgentRuntime，仅以只读、最小权限的 Profile 区分，不新增执行引擎。
- **验证者职责边界。** 只读检查节点目标、完成标准、可见资源与节点报告，提交“节点版本 + 通过/不通过 + 理由 + 证据引用”；不改文件、资源或 Roadmap，不发消息，不直接完成节点。重规划仍由 Main 通过既有 Roadmap 修改完成，最终完成确认仍由 Human。
- **Human Gate 不变。** 保存、恢复、验证结论与 Roadmap 变化都不自动启动 Agent；中断的 Turn 重启后不自动续跑。

### 坑与发现

- 原 PRD 第 6 节 Phase 10 只写 Evidence + Verification，未包含持久化；经用户确认，已同步改为“Durable Project（持久化与恢复）+ Evidence + Verification”。
- 跳过节点不需要验证结论，否则会阻断用户主动放弃的可选路径；已写入 F10.6 完成标准。
- 节点版本变化后旧结论失效，防止“先验证再修改”绕过门禁；具体版本口径在 F10.0 设计时确认。

### 下一步

先按 [Bug 跟踪表](bug-plan.md) 处理 BUG-004，再定位 BUG-001/002，使 F9.8 收口；之后开始 F10.0 设计收口。

（2026-10-09 补注：BUG-001/003/004 已于 2026-10-07 修复，BUG-002 经用户决定保持未关闭、不阻塞 F10；F9.10 已插入并完成。当前下一步以 [后端计划](backend-plan.md) 第 10 节为准，即 F10.0。）
