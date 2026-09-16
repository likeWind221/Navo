# F9.3 修复方案：事件状态与节点地图

## 做了什么

按用户最新三点要求重新收敛方案：保留 lock/unlock 状态事件，人工 completing/skipped 均满足后续依赖，删除 Board 投影和循环步骤。本记录取代上一版“locked/idle 只读派生、必选 skipped 仍阻塞”建议。仅修订方案，未修改代码。

## 关键决策

### F9.3.1 修复：统一 Node 属性与五态

- required/optional 移入 Node，与 work/control 类型独立；Roadmap 仅保存 NodeId 引用、展示顺序、edges 和版本。
- 五态 locked/idle/working/completing/skipped 均为真实事件重建结果。unlock 是操作/事件，操作后状态为 idle，不新增 unlocked 状态。保留 node-locked/node-unlocked、work-started/work-ended、completion-confirmed，新增人工 skip 事件和版本检查。
- 建议正常状态转换：locked -> idle；idle -> working -> idle；idle -> completing；locked/idle -> skipped。完成与跳过为终态；working 需先停止才能跳过。控制节点不进入 working。首次节点仍默认 locked，接入路线后按前置条件初始化解锁。
- completing/skipped 在依赖满足意义上等价，但保留不同审计事实。optional 节点未处理也不阻塞下游；required 节点必须 completing 或 skipped 才满足依赖。穿过 optional 节点仍保留其更上游的 required 条件。

### F9.3.2 修复：状态变更与依赖解锁一并提交

- 使用一个可信领域协调入口处理人工 complete/skip、lock/unlock、属性调整与路线编辑；调用 Node/图纯规则，预计算全部 Node 事件和路线结果，再同步提交。禁止只靠异步 node/event 观察者补做解锁，避免返回时状态未收敛。
- complete/skip 后遍历受影响后继，并检查所有必选祖先是否 completing/skipped；满足条件且当前 locked 的节点追加 node-unlocked，变为 idle。自动解锁不等于自动执行，不越过 idle 自动生成 working/completing/skipped。
- 创建路线、接入节点、修改 edges 或 requirement 后也重新检查受影响节点。若依赖修改令 idle 节点不再满足条件，追加 node-locked；会破坏 working 前提的编辑直接拒绝。对 completing/skipped 不自动改回非终态。
- 手工 unlock 同样检查当前依赖和项目可用性，不作为绕过前置的后门。手工 lock 是当前锁定操作，不新增永久人工 hold 属性；之后影响该节点的依赖/路线变更仍可触发自动 unlock。根节点初始化可解锁；未接入路线节点不允许作为路线工作启动。
- 删除 RoadmapMember、replace/replaced、成员 skip/activate；补充 remove/detach 引用操作，保留 Node 与会话历史；节点移除后不可执行，working 节点不可移除。新 Node、路线编辑和受影响解锁事件使用同一内存提交边界。
- 不让 NodeStore 和 RoadmapStore 循环依赖。统一协调入口应位于它们上层，实际执行入口在创建工作事件前复验当前状态和依赖；直接调用不能绕过。NodeStore 保留日志与投影职责，避免将项目编排塞入 AgentRuntime。
- 跨 Store 重建顺序为恢复日志后读取；重放已记录的 complete/skip/unlock 事件，不在读取或历史重放时再次触发解锁，避免重复事件。现有仅支持批量创建的事务边界需扩展到已有节点的状态/属性事件，不能以连续调用多个公开方法冒充原子提交。

### F9.3.3 修复：只读地图数据

- 删除 board.ts、BoardNode、eligible、action、member 和进度统计投影。以地图查询返回 projectId、projectStatus、projectRevision、roadmapRevision、按展示顺序排列的公开 Node 数据及其 revision/status/requirement/kind，以及 edges。
- 查询只读取已提交状态，不计算新状态、不发解锁事件。前端负责绘图、排版和展示统计，后端保留实际执行权限及依赖校验；不把会话消息、绑定凭据或整个私有 Store 作为公共返回值。
- 本修复先提供后端类型化查询；现有前端/RPC 尚无该契约，需按 F9.9 前后端串行确定版本、Schema、错误和兼容语义，不能把删除 Board 宣称为前端已接入。

## 坑与发现

- 原来 Node idle 与 Board eligible 可以矛盾；修复后将依赖变化落实为真实 lock/unlock 事件，同一状态源服务查询与执行。
- 解锁算法复用 DAG 拓扑/后继遍历，依赖满足为 required 祖先状态属于 completing/skipped。多个前置用 AND，optional 不构成强制等待；仅解锁直接后继可能漏掉穿过 optional 的更远节点，需覆盖受影响后继子图。
- 属性属于 Node 后，requiredBefore 不能仅按 Roadmap revision 缓存；规划变更使用候选 Node 属性计算。节点状态变更影响资格，但不必为其伪造结构修改或增加 roadmapRevision。
- 项目归档时执行入口拒绝启动，working 按取消流程结束，不把正在执行事实覆盖成 locked。Project 状态单独返回，不能只凭 idle 表示项目允许执行。

## 验收与下一步

- 菱形图 A->B->C->F、A->D->E->F：部分前置完成不能提前解锁汇合；完成或跳过全部 required 前置后自动解锁；optional 未完成不阻塞。
- A required -> B optional -> C required：A 完成/跳过后，B/C 都能按规则解锁，C 不等待 B；事件记录恰好一次，读取不会新增事件。
- 多轮 working/idle 后人工完成或跳过；control 无 Session；手工 unlock 不能绕过依赖；路线变化使 idle 重新 locked，非法改动不影响任何 Store；查询返回与事件状态一致。
- 修复范围：src/node 的 model/events/projector/store/session、src/roadmap 的 model/graph/events/mutation/projector/store、相关协调与地图查询模块和测试；删除旧 board 及其过时断言，更新 app 装配。具体协调文件位置按实际依赖决定，不新增通用调度框架。
- 用户当前请求为形成精确方案，尚未授权本轮实施。修复完成后进入 F9.4。Loop 已取消；F10 数据库保持不变。原开发记录保留历史，当前计划指向本方案；本轮仅文档差异检查。
