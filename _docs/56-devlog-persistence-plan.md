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

## F9.3 实施结果

F9.3 后续已经完成并经历设计收敛。最终实现不再采用早期的 Path、soft edge、Roadmap Member 或 Board eligibility 模型；当前权威设计统一见 [59：F9.3 In-Memory Roadmap](59-devlog-f9.3-roadmap.md)。

持久化边界不变：F9.3 的 Roadmap / Node 状态仍是可由事件历史重建的**内存领域状态**，不等于进程重启后的持久恢复。F10 再统一实现 Project、Node、Roadmap、Session、Mailbox、Resource Registry 等状态的数据库持久化、事务边界与中断恢复。
