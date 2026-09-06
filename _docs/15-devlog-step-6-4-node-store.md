# Step 6.4 Node Store 与单 Session 绑定开发记录

## 做了什么

- 实现 Cordis `ctx.learning` 内存 Service，提供 Node 创建、读取、事件读取、Session 绑定和按 Session 反查 Node。
- 实现 `node-created` / `session-bound` 的严格事件投影，返回带 revision 和可选 SessionId 的 `NodeSnapshot`。
- 增加 Learning 模块错误分类，以及提交后的 `learning/event` 通知。

## 关键决策

- LearningStore 生成 NodeId，并且不公开任意事件 append；上层只能通过领域命令提交事实。
- 一个 Node 最多绑定一个 Session，一个 Session 最多归属一个 Node；绑定不会创建或写入 SessionLog。
- 每次读取都从完整事件流投影，不维护可变 Node 快照缓存；Session 反查同样以已提交 NodeEvent 为事实源。
- 事件和返回快照均执行 structuredClone 与递归冻结，调用者不能修改 Store 内部事实。

## 坑与发现

- 反向 Session 索引若在事件发布之后更新，观察者可能看到不一致状态；当前直接从已提交事件投影反查，避免第二份可变事实源。
- Harness 使用异步 transaction tail 和持久化 flush；本 Store 的命令全部同步且仅在内存提交，因此暂不引入两者。
- Harness 对持久化事件做版本化和运行时 schema 解码；当前没有导入或持久化入口，先只做 revision 和关系不变量校验。

## 下一步

Step 6.5 为 Store、projector、错误分类、不可变性、观察者失败和 Cordis 生命周期补充测试。
