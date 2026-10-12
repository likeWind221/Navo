# 83：F10.1b 节点与 Roadmap 持久保存

> 状态：已实现，分支 `phase10-f10.1b-roadmap-persist`。设计依据为 [80](80-devlog-f10-0-design.md) 的 D1、D3、D4，以及 [81](81-devlog-f10-1a-project-persist.md) 建立的存储模块。

## 做了什么

- **存储层**：
  - `EventDomain` 增加 `node`、`roadmap`，复用 F10.1a 的 `events` 表，表结构仍为 v1。
  - 读取时按 owner 返回 `{ projectId, events }`，同一 owner 的 `project_id` 前后不一致时报 `invalid-record`。这部分来自本分支开始前留下的 WIP 提交，已保留。
- **Node 写入落盘**：
  - `NodeBatch.commit` 改为 `seal()`：先做过期检查并关闭批次，再返回每个 Node 的新增历史（`firstRevision`、`projectId`）和要通知的事件。
  - `NodeStore.commit` 先用 `storage.write` 写入 `node` 事件，提交成功后才更新 Map 并发出 `node/event`。
  - 不属于任何 Roadmap 的独立 Node 和 Roadmap 内的人工操作都走这一条路径。
- **Roadmap 一次提交**：
  - `create` / `change` 在提交前算好自动解锁，并入同一个 Node 批次（`findUnlocks` 现在必须传入批次）。
  - `commitTogether` 在一次 `storage.atomic` 里写入 Node 批次和 Roadmap 事件。
  - 删除了提交后再单独解锁的 `unlockReady`，原来的"三次写入"合并为一个事务。
- **启动恢复**：
  - `NodeStore` 构造时重放全部 `node` 事件，再核对存储的 `project_id` 与 `node-created` 中的 Project 是否一致。
  - `RoadmapStore` 构造时，在 Node 恢复之后重放 `roadmap` 事件，并要求 owner 等于存储的 `project_id`、对应的 Project 存在。
  - 任一校验失败都包装为 `StorageError("invalid-record")` 并拒绝启动。恢复时不产生新事件，也不重新计算解锁。
- **Node 回合收尾**：`NodeSessionService` 的 `finally` 改为先清理 active / controller，再写 `work-ended`。这样 `work-ended` 写入失败时，不会留下残留的 active 状态。
- **Mock Host**：新增 `NAVO_MOCK_LLM_MODE=roadmap`。第一次模型调用发出 `create_roadmap`（a → b 两个 work Node），之后返回普通文本，供真实进程重启验收使用。

## 关键决策

| # | 决策 | 理由 |
|---|---|---|
| 1 | 不新建表，`owner_id` 用 nodeId / projectId，`seq` 等于事件的 revision | 当前状态由事件投影得出，不入库（D1）；新增 domain 不需要升数据库版本 |
| 2 | 自动解锁在提交前并入批次，而不是提交后再补写 | `atomic` 延迟 apply，提交前内存还是旧状态，提交后再算就会成为第二次写入。合并后满足 D3"一次操作的全部事件在同一个事务中" |
| 3 | 一次 Roadmap 操作只有一个 Node 批次 | 同一个 `atomic` 里如果有第二个批次，它会读到尚未 apply 的旧内存，触发 `sequence-conflict`。现在的写入路径都满足这一点 |
| 4 | Host 整体退出时，正在执行的 Node 写不进 `work-ended`，库中保持 `working` | Cordis 会启动依赖方的异步清理，但不等它结束就销毁被依赖的服务（已用小实验验证），此时 `storage` 已不可访问。按 D6，这种中断由 F10.3 在重启时收尾。`tests/project/runtime/disposal.spec.ts` 的整体销毁用例因此改为断言 Node 回合被拒绝、状态保持 `working` |
| 5 | 不改 RPC 契约 | 存储失败继续由 Host 映射为 `internal`；通过 Main 工具调用时，模型收到工具失败 |

### DeepSeek Harness 对照

| 源码（`D:\Program\Miracle\kernel\packages\session\session-persistence-sqlite\src\index.ts`） | 采用 | 差异 |
|---|---|---|
| `appendBatch`：一个批次的全部事件在一个事务内 INSERT，任何一条失败就整体 ROLLBACK | 一次领域操作的全部事件在一个事务中写入，失败时整体回滚，内存不变 | Harness 一个批次只写一个 Session；Navo 一个事务跨多个 owner（多个 Node 和一个 Roadmap），由 `StorageService.atomic` 收集后再 apply |
| 序号由主键 `(session_id, seq)` 保证唯一 | 主键 `(domain, owner_id, seq)`，写入前检查新事件紧接最大 seq | Navo 额外在读出时检查序号连续、同一 owner 的 `project_id` 一致 |

## 坑与发现

- 自动解锁的事件行在库中按 owner 分组写入（同一个 Node 的创建和解锁相邻），不是按发生顺序。重放只依赖 `(owner_id, seq)`，不受影响。
- `beginWork` 要求 work Node 已绑定 Session，测试里需要先 `bindSession`。
- `node/event` 在微任务中通知；断言"没有通知"之前要等一个宏任务，避免把前面操作的通知算进来。
- 变异检查：把 `commitTogether` 中的 `atomic` 换成直接执行后，Roadmap 创建和变更的两个失败用例都会失败，说明这两个用例确实能发现原子性被破坏。
- 根 `tsconfig` 不包含 `scripts/`，`pnpm typecheck` 不检查 Mock Host。新增模式已用独立的 `tsc` 检查，只剩 Cordis 类型在临时编译参数下的既有误报，并由真实进程测试实际执行。

## 验证

- `pnpm typecheck` 通过；`pnpm test` 87 个文件、517 项全部通过（Windows 11，Node 24.14.0）。
- 存储层：一个 `atomic` 里写多个 Node 和 Roadmap，任一条序号冲突就整体回滚；成功时各 owner 的历史正确。
- Roadmap 与 Node（`tests/roadmap/persistence.spec.ts`）：
  - 创建 Roadmap 时，3 个新建事件和 2 个自动解锁事件在同一次提交中写入；
  - 依次执行手动锁定/解锁、开始/结束工作、确认完成、跳过、带自动解锁的 Roadmap 变更后，重开同一个库文件，`map`、Roadmap 历史和每个 Node 的事件全部一致；恢复后库中行数不变，之后还能继续追加；
  - 用触发器让 Roadmap 行写入失败时，创建 / 变更涉及的 Node 行、新 Node 和解锁都不入库，内存不变，也没有 `node/event` / `project/changed` 通知；
  - 确认完成时，如果下游解锁那一行写入失败，上游的完成确认也不生效；
  - Node 被改到其他 Project 名下，或 Roadmap 引用的 Node 被删除时，拒绝启动并报出具体 owner。
- 独立 Node（`tests/node/store.spec.ts`）：完整生命周期重启后一致，按 Session 查找也一致；写入失败时状态不变、不发通知。
- 真实进程（`tests/host/process.spec.ts`）：
  - Mock Host（`NAVO_HOME` 加 `roadmap` 模式）创建 Project → Main 回合创建 Roadmap（idle / locked）→ 通过 `project.node.review.v1` 确认 a 完成（b 变为 idle）→ 退出；
  - 以普通模式重启后，`project.get.v1` 返回的完整详情与退出前相同。
- 未覆盖：
  - 没有在桌面 GUI 中操作；
  - 没有在 Electron 自带的 Node 下重跑。存储引擎与 F10.1a 相同，F10.1a 已在 Electron 44.2.0 / Node 24.20.0 下验证过；
  - 没有模拟断电；
  - 应用退出时正在执行的 Node 重启后仍为 `working`，留给 F10.3。

## 下一步

F10.1c 消息与资源登记持久保存：Mailbox 与 Resource 元数据新增对应的 domain。Resource 先写实体文件，再提交元数据事件。
