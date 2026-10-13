# 84：F10.1c 消息与资源登记持久保存

> 2026-10-13，分支 `phase10-f10.1c-mailbox-resource-persist`；本机完成，等待 CI。

## 做了什么

Mailbox 消息和 Resource 四类事件进入现有 SQLite events 表，按 Project 连续 sequence 保存。写入提交成功后才更新内存与通知；启动读回经过既有历史校验，不产生业务通知。资源实体文件在关闭前刷盘，再提交登记；提交失败沿用原有目录清理。Mock Host 增加 handoff 模式，以真实工具发布资源并发送消息，真实进程重启后通过已有 RPC 核对数据与文件内容。

## 关键决策

- schema 仍为 v1，新增 mailbox/resource domain，owner_id 与 project_id 都为 Project ID；资源 revision 仍表示单个资源版本，sequence 表示整个 Project 的事件顺序。
- ResourceStore 持有存储服务，由 append 的唯一提交边界保存事件；Service 负责恢复解析与业务编排。启动恢复不检查 Workspace 在线状态，目录丢失仅在实际读取时报错；现有异步 restore 接口保持原语义。
- 对照 `D:/Program/Miracle/kernel/packages/attachment/attachment-local/src/store.ts` 的 saveImageFile：采用实体先 write/sync/close，再公开引用；Navo 用 createWriteStream 的 flush:true。复用领域存储先持久、再改内存/通知的顺序。不采用内容寻址、哈希、去重 link 和目录 fsync：本 Step 使用独立资源目录，Windows 不支持目录刷盘。
- ResourceService 为单一资源编排所有者，当前 298 行；process.spec.ts 为同一 Host 生命周期验收模块，虽超过 300 行，本次保留既有结构，不做无关拆分。

## 坑与发现

- 内存 restore 不写库；旧 Mailbox 测试要在继续追加前显式把恢复历史写入目标测试库，不能让生产追加逻辑隐式补写历史。
- 本机默认 Node 为 22，验收改用 Codex bundled Node 24.19.0。完整测试首次 522/523 通过，既有 Fetch 本地连接测试在默认并发下超过 5 秒；降低为 maxWorkers=2 后 523/523 通过，未修改 Fetch。
- 根配置不含 scripts；临时继承根 tsconfig 并包含 mock.ts 的类型检查通过。临时文件已删除。
- 持久化测试覆盖重开库后继续序号/版本、公开访问范围和删除历史、目录丢失、SQL 触发器模拟四类资源和消息保存失败、无通知及失败文件清理、坏记录与序号断档。
- 掉电场景未实测；flush 顺序由代码保证。进程崩溃可能留下无人引用的实体文件，按设计允许。本 Step 不实现单 Project 损坏隔离、Session 保存和中断修复。

## 下一步

最终本机 pnpm typecheck 与 pnpm exec vitest run --maxWorkers 2 通过（88 文件，527 项）；扩展配置检查 Mock Host 通过。CI 结果将在 PR 收口时登记；CI 通过后等待用户确认 squash 合并。下一开发步骤为 F10.1d。
