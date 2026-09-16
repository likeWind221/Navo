# F9.3.1–F9.3.2 控制节点与路线服务

## 做了什么

- 用户明确授权完成两个步骤。本轮补齐控制节点，实现并装配 RoadmapStore；下一步为 F9.3.3。修改 Node model/events/projector/store/profile、Roadmap model/errors、src/app.ts 和相关测试；新增 Roadmap events/mutation/projector/store、控制节点与路线服务测试。
- Node 区分 work 与 control；control 的 purpose 为 start/end/checkpoint，包含 title，不需要工作目标或会话。路线继续统一引用 NodeId，required/optional 与节点种类无关。
- 控制节点新建 locked，可人工 unlock/lock，在 idle 时通过带 reviewedRevision、confirmedBy、reason 的可信入口确认为 completing。拒绝 Session 绑定、Agent Profile 和 working；事件重放也拒绝伪造执行事件。完成为终态，不支持重新打开已完成的控制点。
- RoadmapStore.create/change/get/getEvents/restore 已通过 src/app.ts 装配。create 支持空图或初始路线；change 支持批量 insert/connect/disconnect/reorder/requirement/skip/activate/replace。输入输出为后端类型协议，尚未暴露工具或公共 RPC。

## 关键决策

### 状态与事件

- NodeSnapshot 输出显式 kind；旧工作节点 create 输入未提供 kind 时仍按 work 处理，旧 v2 node-created 历史重建为 work。v2 新增 control-created 事件，无数据库迁移或公共契约变更。
- RoadmapSnapshot 保存 revision、只读 graph 和 members。active/skipped/replaced 是路线成员状态；跳过保留节点和连接，不使其人工完成；替换将旧条目标为 replaced，记 replacementId，继承旧条目的要求、展示位置与连接，新条目 active，旧 Node/Session 保留。
- 新事件 v1 包含 id/projectId/baseRevision/revision/timestamp/reason，创建事件保存定义，修改事件保存有序 changes。空批次、空原因、非法版本、重复事件等被拒绝；修改成功只追加一个版本。事件与快照脱离输入并深冻结。
- applyRoadmapChanges 在局部数组上顺序应用操作；连接等结构不变量在整批操作结束后统一由 buildRoadmapGraph 校验，因此同一批可先连接再插入目标节点。需要现存条目的操作按批内顺序检查。不会逐个把半成品发布给 Store。
- projectRoadmap 按连续版本重放事件，复用 mutation 和 graph；不运行工具或恢复 Node 生命周期。restore 只向空 RoadmapStore 导入，要求 Project 和历史涉及的 Node 已存在，允许恢复归档项目用于读取；不允许覆盖现存路线。

### 同步提交与运行保护

- create/change 可携带 newNodes（显式 NodeId 与创建参数）。NodeStore.createBatch 先生成并验证全部候选事件和快照，再调用可信同步校验函数；RoadmapStore 在其中检查整段历史生成的候选图、所有新节点确实接入最终图、项目归属和运行影响。任一失败均不写入两个 Store。
- 校验成功后同一同步调用栈内提交 Node histories 与 Roadmap histories/snapshot。其间没有 await、外部观察回调或 I/O；仅后续 Map 写入。Node 通知统一延迟到 microtask，按调用顺序排队，观察者运行时两个 Store 均已提交。没有设计通用事务框架，也不提供异步验证回调。
- createBatch 的 validate 属于可信内部同步扩展点，必须无副作用且返回 undefined；不是可交给模型的输入。当前保证为内存校验失败原子性，不宣称进程崩溃一致性或数据库事务能力。F10 需重新定义持久事务边界。
- 拒绝 skip/replace working 节点；拒绝给 working 节点引入未完成或 skipped 的必选祖先；同样拒绝把既有必选前置从 active 改为 skipped。前置已 completing 且 active 时允许合法新增连接。校验包括通过其他节点传递的必选祖先。
- Node 通知仍为观察出口，失败记录沿用既有 logger，不影响已完成提交；本步未增加 Roadmap 广播协议，未来 F9.9 明确公共事件。

### 参考与模块边界

- 只读参考 `deepseek-harness/packages/plan/plan-mode/src/index.ts` 的 `foldPlanMode`：从日志派生状态；沿用事实/投影分离。Harness 的协作模式不负责本项目跨 Node 图编辑或原子创建，不照搬其命令和审核工具。
- events 是公共变更协议，mutation 是纯编辑逻辑，projector 是历史解释器，store 拥有持久于当前进程的 Map。NodeStore 仅增加自己的批量创建入口，不依赖 Roadmap 私有实现；AgentRuntime 保持不变。
- model/errors 的短文件保留独立领域协议与错误边界。新增生产文件均低于 250 行；已有 tests/node/session.spec.ts 超过 300 行，本轮只增加控制节点入口拒绝测试，保留既有 FIFO/取消集成场景组织，避免无关拆分。

## 坑与发现

- 不能先单独创建 Node 再尝试改路线，失败会留下孤立节点；本次测试验证错误图和无效节点均不留下部分提交。
- 仅检查“新增前置”不足以保护 working 节点；把已满足前置改为 skipped 同样会破坏条件，已修正并补回归测试。
- 验证：先运行 `pnpm exec vitest run tests/roadmap tests/node tests/integration tests/host/tools.spec.ts tests/project tests/tools/search/tool.spec.ts`，12 文件、86 项通过；补上述运行保护后，仅重跑 `tests/roadmap/store.spec.ts`，8 项通过（含新增一项）。合计覆盖 87 个相关场景，并非一次运行 87 项；最终 `pnpm typecheck` 通过。文档/差异检查通过。
- 实测包含控制节点人工完成与伪造历史拒绝、NodeSession 不启动模型、已完成第一阶段接续新工作/控制节点、观察者看到一致状态、整批失败不留节点、版本冲突、替换留痕、跳过/激活、陈旧/损坏历史拒绝、跨 Store 内存重建，以及既有 Node 串行/取消和应用装配回归。

## 下一步

F9.3.3 看板组合实时 Node 状态和路线成员状态；requiredBefore 仍只表示必需前置集合，本步不对直接 NodeSession 执行或人工确认强制执行路线门槛。人工入口目前是可信后端方法，confirmedBy 是审计字段，不代表已经接入身份认证。F9.4/F9.5 实施授权与 Main Agent 工具，F9.9 接入人工 UI/RPC，F10 数据库；Loop 未实现。

本轮未修改 frontend/** 或公共 RPC。后端串行更新本记录、索引和计划，保留其他未提交修改；最终回复按用户要求简要说明机制与实际边界。
