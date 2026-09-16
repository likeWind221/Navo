# F9.3.1 路线结构与关系表达

## 做了什么

后续交付更新：控制节点与 RoadmapStore 已在 F9.3.2 完成，最新状态见 [59：控制节点与路线服务](59-devlog-roadmap-store.md)。下文描述最初图结构交付时的范围。

- 已完成 `src/roadmap/model.ts`、`graph.ts`、`errors.ts` 和 `tests/roadmap/graph.spec.ts`；2026-09-15 按用户纠正改为节点级 required/optional，删除先前的 forks/paths。复审记录见 [58](58-devlog-roadmap-review.md)。
- `buildRoadmapGraph(definition, catalog)` 接收可信后端定义与 Node 身份/项目目录，检查归属、重复引用、要求枚举和环，返回深冻结的定义、关系与拓扑顺序。不修改 Node，不接 Cordis 或执行器。

## 关键决策

- nodes 保存 `{ nodeId, requirement }`，数组顺序是展示顺序；edges 保存 `{ from, to }`。必选/可选属于节点在路线中的参与要求，不属于路径、边或 Node 执行 status；无默认值，调用方必须明确指定。
- 分叉和汇合自然由一对多、多对一连接表达；支持嵌套分叉、交叉连接、空图和独立节点，无需分支组身份、路径归属或专门汇合节点类型。
- requiredBefore 包含当前节点所有必选祖先，排除可选祖先。沿拓扑顺序传播祖先集合，可选节点自身不加入，但它上游的必选祖先继续传递。比如 A 必选 -> B 可选 -> C 必选，C 仍等待 A，不等待 B。
- predecessors/successors 是直接结构连接，requiredBefore 是后续看板检查人工 completing 的集合；二者不能混用。拓扑顺序是结构分析结果，不是必须逐项执行的顺序，也不能当作等待可选节点的依据。
- Kahn 判环为 O(V+E)；必选祖先集合传播最坏 O(VE)，输出集合最坏 O(V²)，不能将整个构建器描述为线性复杂度。当前内存路线规模下采用直接集合实现，不添加缓存或增量维护框架。
- model/errors 为独立协议和可抛出错误边界，虽短仍单独保留。参考 Harness `deepseek-harness/packages/plan/plan-mode/src/types.ts` 的纯协议边界及前期检查的 `src/index.ts` 中事实与投影分离；它不是项目图实现。没有引入 LangGraph 或复制执行引擎。

## 坑与发现

- 原实现误把用户的可选要求绑定整条路径，并限制分支内部只能线性连接，现已修正。删除错误路径及旧类型引用，测试转为用户提供的六节点图和节点级可选情形。
- 当前 API 面向可信类型化后端，不是未知 JSON 解析器；catalog 可信性由调用方保证，Project 活跃状态、Node 实时状态与完整外部 Schema 留待 Store/RPC。
- 初版 22 项测试曾通过但语义与用户需求存在偏差；最新验证以 58 号记录为准，不能用旧测试通过代表设计符合需求。

## 下一步

- F9.3.2 内存 Store、版本和历史；F9.3.3 实时看板；F9.3.4 循环轮次；F10 数据库。当前直接回边仍被拒绝，Loop 未实现。
- 本轮没有修改前端、RPC 或应用装配。复审交付提供新模型、必选祖先算法、实际边界和验证结果。
