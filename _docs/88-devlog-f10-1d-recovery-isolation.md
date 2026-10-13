# F10.1d：损坏隔离与整体重启验收

## 做了什么

- 新增启动前 `RecoveryPlan`，从 SQLite 事件与 Workspace 绑定建立按 Project 的恢复候选集。
- 复用 Project、Node、Roadmap 与 Resource 的投影校验，抽出 Mailbox 历史解析；只有六个领域全部通过的 Project 才进入各 Store。
- 损坏的 Project 被整体跳过，其他 Project 继续启动；恢复不写数据库、不删除资源文件、不发 `project/changed` 通知。
- 扩展单元验收：坏的 Mailbox、Resource、Node、Roadmap 序列或内容只隔离所属 Project，并验证同库其他 Project 仍可恢复且坏记录保持原样。
- 扩展真实 Host 两进程验收：同一场景创建 Project、Workspace、Roadmap、Node、Mailbox 与 Resource，关闭并重新启动后核对完整 Project 详情、消息和资源内容。

## 关键决策

`StorageService` 在数据库打开和 schema 检查通过后先构造恢复计划。计划按 Project 聚合原始记录，区分无法归属到 Project 的存储读取错误与可归属的内容损坏；后者只加入隔离集合。各 Store 从计划中的最终有效集合恢复，避免先发布再回滚，也不要求每个查询入口识别“损坏”标签。

恢复顺序保持 Project → Workspace → Node → Roadmap → Mailbox → Resource。Workspace 目录是否存在不参与隔离，使用时仍由原有 Workspace 错误报告不可用。Roadmap 的启动恢复复用投影，但关闭启动期 `project/changed` 通知；真实业务变更仍照常通知。

设计参考 `D:/Program/Miracle/kernel/packages/session/session-persistence/src/coordinator.ts` 的 prepare / validate / adopt 生命周期；本步只采用先准备再接入的边界，不引入 Session repair 或 write-behind。

## 坑与发现

- 原有 `loadEvents` 的严格抛错行为保留给直接 Storage API；应用启动使用容错聚合，确保单 Project 内容损坏不变成全局启动失败。
- 资源历史除自身投影外还依赖 Project、Node 和跨 Project 的事件 / Resource 身份唯一性，因此恢复计划在 Resource 阶段补做跨域唯一性检查。
- Node 与 Project 的 Session 所有权冲突在启动前识别，避免恢复到 Store 后才触发全局异常。

## 验证结果

- Node 24.20.0 bundled runtime：`tsc --noEmit` 通过。
- 完整测试：88 个测试文件、528 项通过；重点覆盖 `tests/storage/database.spec.ts`、`tests/project/store.spec.ts`、`tests/roadmap/persistence.spec.ts`、`tests/resource/persistence.spec.ts`、`tests/host/process.spec.ts`。

## 下一步

F10.1d 代码与验收已交付 review；不实现 Session 恢复、执行中断收尾、自动修复、迁移或前端“无法恢复”展示。合并前等待 CI 与用户确认。
