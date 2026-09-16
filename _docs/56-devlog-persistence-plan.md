# 内存路线图与数据库持久化阶段划分

## 做了什么

按用户最新要求，将 F9.3 明确为纯内存 Roadmap，数据库持久化统一安排在 F10；撤销原临时数据库子步骤，Phase 9 按原 F9.4–F9.9 顺序继续。修正 Persistent Roadmap Board 容易被理解为已包含磁盘保存的命名；本次仅调整计划，不实施步骤代码。

## 关键决策

- 可重建表示给定事件历史能算出状态，不代表事件已经保存到磁盘。持久化表示进程退出后数据仍在；恢复需要读取持久记录、重建状态并处理执行中断。
- 当前 ProjectStore、NodeStore、SessionStore 均使用 Map。Project 有可信 restore 入口；Node 有历史投影，Session 有消息投影与内存 Surface；没有统一数据库提交或 Host 启动恢复。文件工具写入的普通文件不能恢复项目和会话事实。
- F9.3 不新增数据库、自动 JSON 落盘或通用存储框架。F10 覆盖 Project、Node、Roadmap、Session、消息、工具调用/结果与必要回合记录，以及 Session Surface 和可信运行配置的恢复边界。
- 建议数据库阶段优先评估本地 SQLite：适合桌面、无需独立数据库服务。采用一个后端存储所有者管理连接和事务；具体表结构、驱动、迁移与提交边界在该步骤设计时确认，不在功能计划内提前固化。
- 建议保留领域事件作为可追溯事实，按实际查询需求建立消息/状态读模型。快照是重建性能优化，可后加；不要让事件表和消息表成为两套可以独立修改的权威事实。也不把每个网络 token 块自动视为必须永久存储的领域事件。
- 恢复历史不能重放工具副作用。进程退出后的 AbortController、Promise 队列不能原样恢复；中断回合和 working 状态需要在数据库阶段定义恢复处理。人工 completing 仍不可自动生成。

## 坑与发现

- 现有 Node/Session 观察事件是在内存提交后通知，观察者失败不会令提交失败。数据库接入不能简单订阅事件写库后仍把原调用返回当作已持久保存，需要明确等待数据库事务成功的提交语义。
- SQLite 同一数据库同时只允许一个写事务；多 Node 的模型/网络执行仍可并行，短数据库事务由后端统一协调。未来多主机高并发写入再评估服务端数据库。
- 官方参考：[SQLite 适用场景](https://sqlite.org/whentouse.html)、[SQLite 应用文件格式](https://www.sqlite.org/appfileformat.html)、[Microsoft Event Sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)。事件重放与快照是业界方案之一，不要求所有业务都使用事件溯源。

## 下一步

先实施 F9.3 内存路线图，再完成其余 Phase 9 步骤；F10 实施数据库持久化与恢复。原 Evidence/Verification 目标保留，持久化之后重新排期。后者验收必须实际关闭并重启后端读取旧数据，不能用同进程 Map 或仅 JSON 序列化测试替代。本轮检查源码与官方资料，更新计划和索引；未变更生产代码，未运行无关测试。

## Codex、Pi 与数据库选型补充调研

- Codex 本地开源内核使用 JSONL rollout 保存会话记录，并使用 SQLite 保存 rollout 元数据和可恢复运行状态，不能概括为所有消息均只在 SQLite。[state 源码](https://github.com/openai/codex/blob/main/codex-rs/state/src/lib.rs)、[rollout recorder 源码](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs)、[官方配置](https://developers.openai.com/codex/config-reference/)。本结论不外推到 Codex 云服务的私有数据库。
- Pi 官方当前 Session Format 明确使用 JSONL，会话条目通过 id/parentId 形成树，包含消息、模型切换、压缩和分支摘要；其标准会话持久化不依赖 SQLite。[Pi 官方会话格式](https://pi.dev/docs/latest/session-format)。原 badlogic/pi-mono 已跳转到 earendil-works/pi，旧 raw 路径失效后改用当前官方文档。
- SQLite 适合本地嵌入式关系数据；MySQL/InnoDB 适合统一服务端、多用户共享的事务数据；Redis 可用于缓存、限流、短期协调，并支持 RDB/AOF 持久化，但不应因为运行时使用 Map 就直接用 Redis 代替项目主存储。[MySQL InnoDB](https://dev.mysql.com/doc/refman/8.4/en/innodb-introduction.html)、[Redis 持久化](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)。F10 对当前单机 Navo 优先评估 SQLite；没有当前需求时不加 MySQL 服务或 Redis 层。

## F9.3 拟实现方案（未编码）

后续交付更新：控制节点与 F9.3.2 内存服务现已实现，见 [59：控制节点与路线服务](59-devlog-roadmap-store.md)；下文保留早期方案背景，当前下一步为 F9.3.3。

实施状态更新：F9.3.1 已完成，2026-09-15 按用户纠正将 required/optional 移到节点条目，删除路径组协议；实际结构以 [57：路线结构与关系表达](57-devlog-roadmap-graph.md) 和 [58：节点图设计复审](58-devlog-roadmap-review.md) 为准。以下包括“最新修订”在内均为历史讨论，路径级必选/可选方案已撤销，其余子步骤尚未编码。

### 最新修订：必选路径与可选路径

按用户最新意见，撤销软顺序语义，采用同级并行分支中的 required（必选）与 optional（可选）。这改变汇合规则，不只是 hard/soft 改名。以下历史方案及 LangGraph 对比中的 hard/soft 表述用于保留讨论背景，冲突处以本节为准。

- 同一分叉到汇合范围内，分支没有隐含先后或优先级，必选与可选均可在入口条件满足后推进；汇合仅等待全部必选分支人工完成。具备并行资格不保证实际同时调度。
- 可选分支未开始、未完成或失败不阻塞后续阶段；进入下一阶段不自动将可选分支标记完成、跳过或取消。必选分支被跳过仍不满足汇合，需显式调整路线要求。完成沿用用户人工 completing 约定。
- required/optional 属于路线中分支的参与要求，节点 status 属于执行生命周期，active/skipped/replaced 属于路线成员状态，三者分开。可选分支内部仍可存在必须遵守的执行先后，不能把整条可选分支的所有边都解释为无前置约束。
- F9.3.1 设计建议显式表达并行分支的入口、汇合点及分支要求，验证单节点和多节点分支；具体最简结构在该 Step 确认。不要仅把 soft 边重命名为 optional 后沿用原判断。无必选分支时，建议在入口条件满足后不额外等待可选分支。
- F9.3.2 管理分支插入、替换、参与要求调整及版本提交；F9.3.3 分开显示必选完成进度与可选完成情况，并说明汇合还在等待哪些必选分支。三个子步骤均未实现，数据库仍安排在 F10。
- 本轮修改后端计划和本设计记录，未修改共享 PRD、索引或生产代码。PRD 中的弱依赖/推荐顺序与最新用户要求有差异，后续共享控制面串行同步时需替换；当前后端设计以本节和后端计划为准。

### 按用户建议拆分

- F9.3.1 路线结构与关系表达：`src/roadmap/model.ts` 定义节点引用、带类型的有向边和展示顺序；`graph.ts` 负责关系校验、前驱/后继索引及硬依赖环检查，`errors.ts` 定义领域错误；`tests/roadmap/graph.spec.ts` 验证链、菱形分支与汇合以及非法关系。以条目表、边列表和顺序数组作为结构，不维护第二份权威邻接表，查询时派生索引。节点目标、会话和执行状态继续归 NodeStore 所有。
- F9.3.2 路线变更与历史重建：新增 `events.ts`、`projector.ts`、`store.ts` 与对应测试，修改 `src/app.ts` 接入服务。Store 管理创建、查询和整批变更，先构建候选状态并校验，再提交一个版本；投影器重放已接受事件。此处 candidate change 指尚未接受的变更提案，candidate state 指应用提案后的临时状态，均不是可执行节点集合。
- F9.3.3 进度看板与执行资格：新增 `board.ts` 与对应测试，组合 Roadmap、Project、Node 当前事实，派生阻塞原因、执行资格和统计。Roadmap 历史单独只能重建路线结构；重现历史看板还需要当时的 Project/Node 状态。看板不是额外的权威状态，不负责启动执行。
- 硬边 A -> B 表示 B 必须等 A 人工完成；软边 A -> B 表示建议先 A 后 B，既不阻塞 B，也不传输 A 的结果。展示顺序仅用于稳定排列。分支用一对多边、汇合用多对一边，硬汇合采用全部前置满足的 AND 语义；条件选择和任选一路的 OR 汇合暂不纳入。硬依赖子图无环，软顺序出现冲突时不强行保证全部建议同时成立。
- 参考只读检查：`deepseek-harness/packages/plan/plan-mode/src/index.ts` 的 `foldPlanMode` 从已记录事件派生状态，`src/types.ts` 定义独立的 PlanProjection。采用事实与投影分离；其 plan mode 是会话协作模式，不是项目依赖图，因此不照搬其审核工具、命令生命周期或模式状态作为 Roadmap。
- 本轮只更新本记录与后端计划，三个子步骤均未编码；未修改共享索引、前端或 RPC。数据库仍在 F10。

### 整体约束

### LangGraph 图表达借鉴（2026-09-14）

- 官方 Graph API 将工作流划分为 State、节点函数和路由边，并在构建后 compile；节点返回状态更新，由 reducer 合并。参考 [JavaScript Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)。Navo 可借鉴结构、状态与执行职责分离，以及提交前校验；F9.3 不引入 LangGraph 依赖或编译执行器。
- 分支需区分并行扇出与条件路由，汇合需明确等待条件。官方 Python [add_edge](https://reference.langchain.com/python/langgraph/graph/state/StateGraph/add_edge) 明确列表前置需要全部完成。Navo 的全部 hard 前驱也采用 AND，但等待的是人工 completing，不是函数返回。普通多条入边不能泛化解释为任意执行引擎都自动提供 AND 屏障。
- [官方图实践](https://docs.langchain.com/oss/javascript/langgraph/use-graph-api) 展示条件分支、循环与 Command。条件路由不是 soft order：前者决定实际执行路径，后者仅建议优先次序。Navo 当前保留 hard/soft 边；条件选路及 OR 汇合仍需另行定义选择记录，不因本次调研加入 F9.3。
- Send 将不同输入动态分发到已定义的节点处理逻辑，不等于创建长期存在的新 Node 身份或修改 Roadmap 拓扑。Navo 的插入/替换仍由带版本的 Store 变更负责。
- LangGraph 支持执行循环；Navo 的硬前置关系仍禁止环，重复工作通过节点内回合或后续路线变更表达。共享图 State 的 reducer 也不直接替代隔离 Session 和 Main/Mailbox 通信。
- 设计建议：继续使用 NodeId 条目、有类型的边、独立展示顺序；F9.3.1 明确并行和 AND 汇合测试，F9.3.2 每次变更校验候选图，F9.3.3 从当前领域事实计算资格。以上是针对 Navo 的取舍，不是 LangGraph 自带的 Roadmap 能力。本轮只补充设计记录、核对官方资料并检查文档差异，未编码或安装依赖。

### 领域实现边界

- 一个 Project 对应一个 Roadmap，以 ProjectId 定位；Roadmap 保存条目、hard/soft 关系、稳定展示顺序、版本与变更原因，引用 NodeId，不复制 Node 目标、会话或四态。
- 条目区分 active/skipped/replaced，表示路线成员状态，不是 Node 的 locked/idle/working/completing。跳过不算完成人工验收；硬依赖仍阻塞，除非显式修改关系。替换在一个变更中接入替代节点、转接关系并保留旧条目记录；校验同项目、引用与循环后提交。
- Store 接收带 baseRevision 的可信变更：插入、关系调整、重排、跳过、替换。先在候选状态应用整批变更，再检查不变量，成功后追加一个版本事件；失败不提交部分结果。F9.5 才把这些能力交给 Main Agent 提议链路。
- 硬依赖子图做拓扑检查，允许 soft 关系形成推荐顺序而不作为执行门槛。禁止跨项目、悬空、自依赖、重复条目/关系及非法替换；拒绝影响正在执行节点的跳过/替换或新增未满足的执行前置条件。
- Board 读取 Roadmap 与当前 Node 快照，返回各节点原始 status、路线成员状态、阻塞原因、eligible 和分开统计的人工完成/跳过/替换数量。idle 且 Project 活跃、条目 active、所有 hard 前置人工 completing 才具备执行资格；soft 仅提供建议。计算时不修改 Node，不自动解锁或完成节点。
- `src/roadmap/model.ts`、`events.ts` 定义协议，`store.ts` 管理内存历史，`projector.ts` 重放与检查关系，`board.ts` 计算展示投影，`errors.ts` 定义领域错误；`src/app.ts` 装配，`tests/roadmap/` 验证。按实际大小决定是否拆出关系算法，不预建存储适配框架。
- 验收包含 A/B 独立而 C 依赖 A：A/B 可并行，A 的 Turn 正常结束但状态仍 idle 时 C 仍阻塞；人工确认 A 后 C 获得资格；跳过 A 不自动放行 C。另验证软顺序不阻塞、环路拒绝、旧版本拒绝、替换原子性和历史重建一致。
- 只实现领域查询与变更，不接数据库、前端/RPC、自动执行或文件保存。NodeSession 直接执行入口尚不统一执行 Roadmap 门槛；执行资格的真正调度接入在后续 ProjectRuntime 阶段完成，不能把 Board 计算误称为已强制执行授权。
