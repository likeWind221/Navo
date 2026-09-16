# F9.3 状态模型修复

## 做了什么

完成 F9.3.1–F9.3.3 修复：Node 将 `required/optional` 作为属性，状态统一为 `locked/idle/working/completing/skipped`；Roadmap 只保存 NodeId 与 edges；新增内存批处理、路线变更、历史重建和节点地图查询。删除 Board、成员状态、replace/replaced 及循环路径。

## 关键决策

- `completing` 与 `skipped` 都是人工确认的终态，依赖判断等价；完成或跳过后，RoadmapStore 在同一 NodeBatch 中追加满足条件节点的 `node-unlocked` 事件。
- 自动解锁按 DAG 拓扑顺序检查 `requiredBefore`，多个前置使用 AND；可选节点不构成强依赖，但会继承更上游必选祖先。
- 手动 `unlock` 经过同一协调入口校验，不能绕过必选祖先；没有路线的独立 Node 保留原有 NodeStore 生命周期。
- 路线变更先在候选历史和候选节点目录上完整校验，Node 创建与路线历史随后一起提交；失败时不留下孤立节点或新路线版本。
- `map(projectId)` 只返回已提交的 NodeSnapshot、节点属性、状态、版本和 edges，前端负责重建图形。

## 坑与发现

- 初版批处理在自动解锁时重复追加同一事件，导致 projector 拒绝 `idle` 节点再次 unlock；修复为批处理内部更新候选状态后继续拓扑扫描。
- 路线不存在时，Node 操作不能因为 Roadmap 协调器存在而失效，因此协调器对独立 Node 回退到 NodeStore 批提交。
- optional 节点位于必选路径上时，不能简单删除其祖先条件；`requiredBefore` 需要沿拓扑传播必选祖先集合。

## 验证与下一步

- `pnpm typecheck` 通过。
- `pnpm test` 通过：51 个测试文件、351 个测试。
- F9.9 仍需定义并接入前后端只读 Project/Roadmap 契约；F10 再实现数据库持久化、启动恢复和消息记录。
