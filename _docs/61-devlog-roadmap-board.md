# F9.3.3 进度看板与执行资格

## 做了什么

- 用户确认实现 F9.3.3。新增 `src/roadmap/board.ts` 和 `tests/roadmap/board.spec.ts`，修改 `src/roadmap/store.ts`，提供 `ctx.roadmaps.getBoard(projectId)`。后端串行登记本记录和索引，保留前端正在进行的修改；60 号记录属于前端，本记录使用 61。
- Board 返回 projectId/projectRevision/projectStatus、roadmapRevision、节点行与进度计数。节点行保留当前 NodeSnapshot（含节点类型、状态和版本）、成员状态、必选/可选要求、必选祖先、阻塞原因及可执行动作。

## 关键决策

- getBoard 同步读取三个 Store 当前快照，不缓存，不写事件。projectBoard 是纯计算函数；沿当前定义的展示顺序生成节点行，再追加被替换的历史成员。替换成员 requirement 为 null，不推断其历史要求，replacementId 继续保留。
- 资格要求 Project active、成员 active、Node idle，以及所有 requiredBefore 节点同时为 completing 和成员 active。工作节点 action 为 run，控制节点 action 为 confirm；eligible 只表示对应动作具备路线条件，不自动执行，不代表鉴权完成。工作节点是否可人工验收不属于本字段含义。
- blockers 使用联合类型：project-archived、member-inactive、node-not-idle、prerequisite。前置阻塞包含对应 NodeId、实时状态和成员状态；保留全部适用原因。已完成节点也会以 node-not-idle 说明当前不可再次运行，不将此原因等同于任务失败。
- required/optional 进度分别返回 total/completed。分母包含当前 active 和 skipped 节点，分子只计算 active 且 completing 的节点；replaced 排除并独立计数。跳过必选节点不能提高完成率，空图为 0/0，不自动解释为项目完成。控制节点计入其要求对应的进度。仅统计路线成员，不计入未接入路线的项目节点。
- 通过 Map 建立节点、成员和关系索引；遍历每个节点的已计算必选祖先集合检查当前状态，无需重新做拓扑排序。计算成本为 O(N+R+K)，N 为提供的 Node 快照数，R 为路线成员数，K 为祖先引用总数；另有复制快照数据的成本。
- 最终结果 structuredClone 后递归 freeze，与输入分离，后续状态变化不修改旧看板对象。缺失路线报 not-found；项目缺失报 project-unavailable；纯投影输入项目不匹配或节点引用缺失报 invalid-reference。内部结构依赖已验证 Store 输出，不重复建立未知 JSON 校验框架。
- 参考 `deepseek-harness/packages/plan/plan-mode/src/types.ts` 中独立 PlanProjection 的事实派生边界；该模块不是项目图，本步不照搬其命令 pending 语义。投影不拥有第二份可修改的执行状态。

## 坑与发现

- Node 回合结束后 idle 不等于人工完成；控制点等待必选祖先完成，但无需等待可选祖先或创建 Session。
- 必选祖先虽然已经 completing，若成员被标 skipped 仍阻塞。替换后下游等待新节点，旧节点仅留作历史展示。项目归档仍可查询进度，但所有动作资格关闭；重新打开后重新计算。
- 验证：`pnpm exec vitest run tests/roadmap` 三个文件共 32 项通过（含本轮新增 6 项看板场景）；`pnpm typecheck` 通过，差异检查通过。覆盖实时状态变化、工作/控制动作、回合结束与人工确认区别、跳过/激活、替换/展示顺序、归档/重开、空图、未接入节点、不可变及缺失引用。未启动真实模型或前端。

## 下一步

F9.3.3 已完成，下一步 F9.3.4 循环路线与轮次管理。当前资格是后端查询结果，未强制应用到直接 NodeSession/人工确认入口；实际调度门槛由 F9.7 接入，工具、RPC/UI 和数据库分别由后续步骤落实。本步没有自动解锁、完成、调度、Loop 或落盘。

交付回复提供模块地图、计算规则、进度分母、验证和实际边界；未修改 frontend/** 或前端计划，保留共享索引已有内容。
