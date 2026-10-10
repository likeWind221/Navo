# 81：F10.1a 项目与工作目录持久保存

> 状态：已实现，分支 `phase10-f10.1a-project-persist`。设计依据为 [80](80-devlog-f10-0-design.md) 的 D1–D4，以及 2026-10-10 与用户拍板的 9 项实现决策（见“关键决策”）。

## 做了什么

- 新增存储模块 `src/storage/`：
  - `schema.ts`：打开 `navo.db`，设置 WAL、`synchronous=FULL`、`busy_timeout=5000`、`trusted_schema=OFF`；校验 `application_id`（`0x4E41564F`）与 `user_version`（1）；新库初始化 schema；过滤 `node:sqlite` 的 ExperimentalWarning。
  - `database.ts`：Cordis Service `storage`。提供 `write(persist, apply)` 与 `atomic(work)`（延迟 apply），以及启动读取 `loadEvents` / `loadWorkspaceBindings`；Context dispose 时关闭连接。
  - `errors.ts`：`StorageError`，错误码 `storage-unavailable` / `schema-unsupported` / `invalid-record` / `write-failed` / `sequence-conflict`。
- `ProjectStore`：`create` / `setGoal` / `archive` / `reopen` 改为“内存校验生成草稿 → 事务写入 → 提交后更新 Map 并 emit”；构造时从 `events(domain='project')` 恢复；删除 `discard`。
- `ProjectWorkspaceStore`：
  - 拆成 `prepare`（规范化路径、检查冲突、建 `.navo`）和 `bind`（写绑定行）；
  - 新增 `require`，root 或 `.navo` 缺失时抛 `workspace-unavailable`；
  - `cleanup` 的解绑改为持久化；
  - 构造时从 `workspace_bindings` 恢复，不访问磁盘。
- `project.create.v1` 改为先 `prepare`，再用一个 `atomic` 同时提交 `project-created` 事件和绑定行，去掉原来的 discard 补偿。
- 使用 Workspace 的位置改为调用 `require`：`resolve`、Project 文件环境（`app.ts`）、Resource 的 `requireResourceWorkspace`。
- Host：`NAVO_HOME`（默认 `~/.navo`）解析为 `<home>/navo.db`；`NavoAppConfig.storage` 改为必填；Mock Host 未设置 `NAVO_HOME` 时使用 `:memory:`。

## 关键决策

| # | 决策 | 理由 |
|---|---|---|
| 1 | 通用事件表 `events(domain, owner_id, seq, project_id, payload)` 加单独的 `workspace_bindings(project_id PK, root UNIQUE)` | 没有迁移框架，schema 版本不对就拒绝启动；F10.1b/c、F10.2、F10.4 只需新增 `domain` 值，schema 保持 v1。绑定是可删除的当前事实，需要全局唯一约束，所以单独建表 |
| 2 | `write` / `atomic` 延迟 apply | 跨 Store 一次提交，同时不对外暴露“跳过持久化直接改内存”的方法；F10.1b 的 Roadmap、Node、unlock 提交可以直接复用 |
| 3 | 不改 RPC 契约 | 存储失败映射为 `internal`（详情写 stderr），`workspace-unavailable` 映射为 `workspace-invalid` |
| 4 | Workspace 不可用在使用处检测 | 摘要仍显示原 `workspaceRoot`；`.navo` 缺失同样报不可用，不自动重建 |
| 5 | F10.1a 恢复失败时整体拒绝启动 | 单个 Project 隔离留给 F10.1d；Project 校验错误包装为 `invalid-record`，并带上 projectId |
| 6 | `cleanup` 解绑持久化 | 先删 `.navo`，再删绑定行；第二步失败时只会导致下次使用报不可用 |
| 7 | 照搬 Harness 的警告过滤 | 在 `process.getBuiltinModule("node:sqlite")` 期间临时替换 `process.emitWarning`，避免 Electron 侧把这条警告记入 Host 日志 |
| 8 | `storage` 必填 | 避免生产装配漏配后悄悄退化为内存库；测试统一通过 `tests/helpers/storage.ts` 装配 `:memory:` |
| 9 | 分层验收 | 进程级覆盖创建、目标、绑定和版本拒绝；归档、重新打开、设置目标、cleanup 没有公开 RPC，用同一库文件依次开两个 Context 验证 |

### DeepSeek Harness 对照

| 源码（`deepseek-harness/packages/session/session-persistence-sqlite/`） | 采用 | 差异 |
|---|---|---|
| `src/schema.ts` `configureDatabase` | `BEGIN IMMEDIATE` 内同时检查 `user_version` 与 `application_id`；版本 0 但已有对象时拒绝；新库初始化 | 不检查 `persistence_state.store_id`，也不在每次写事务里重新校验 schema。Navo 只有一个 Host 进程写入 |
| `src/schema.ts` `configureConnectionSecurity` | `trusted_schema=OFF` | 不设 `mmap_size` 与 `page_size` |
| `resources/sql/schema.sql` | `STRICT` 表、`(owner, seq)` 主键 | 不建 sessions 元数据表，不做压缩，不用 `ANY` 列；payload 是原样 JSON 文本 |
| `src/store.ts` `importNodeSqlite` | 加载时过滤 ExperimentalWarning | 用同步的 `process.getBuiltinModule`，因为 Service 构造是同步的 |

## 坑与发现

- **只在内存中 `restore` 的数据不算已持久。** 测试先 `restore` 到新的内存库再追加事件，会触发 `sequence-conflict`。这是新语义下的正确行为：Project 测试改为重开同一个库文件。`bind` 允许“内存中已有的 Project 或本事务里刚创建的 Project”：Resource 回放测试只在内存中 `restore` Project 再绑定，生产环境中内存里的 Project 都来自库。
- **重排后 conflict 检查落到了建目录之后。** 第一版 `create()` 先 `prepare` 再检查冲突，把已绑定的 Project 改绑到其他目录时，会在用户目录里留下多余的 `.navo`。已改为先检查冲突再建目录，并补了断言。
- **测试误写了用户主目录。** 第一次全量测试时，进程测试启动真实 Host 但没有设置 `NAVO_HOME`，在 `~/.navo/navo.db` 生成了一个空库（0 事件、0 绑定，schema v1）。该测试已改为使用临时 `NAVO_HOME`；这个空库就是默认位置，保留不删。
- `trusted_schema=OFF` 不影响测试用 `RAISE(ABORT)` 触发器注入写入失败。

## 验证

- `pnpm typecheck` 通过；`pnpm test` 86 个文件、500 项全部通过（Windows 11，Node 24.14.0）。
- 存储层：新库初始化与重开读回；更高版本、外来库、非数据库文件被拒绝；`atomic` 回滚时丢弃所有 apply；序号不连续时拒绝；损坏的 JSON 报 `invalid-record`。
- 领域层：
  - 设置目标、归档、重新打开在重启后一致；
  - 触发器让写入失败时，`setGoal` / `create` 抛 `write-failed`，Map、列表不变，也不 emit；
  - 存储的历史校验失败时拒绝启动；
  - 绑定和 root 归属在重启后一致，cleanup 后不会复活；
  - 目录丢失后 Project 照常恢复，`require` / `resolve` 报 `workspace-unavailable`，不重建 `.navo`。
- Host 层：绑定行写入失败时，`project.create.v1` 返回 `internal`，列表为空，`events` 表 0 行。
- 真实进程重启：Node 下启动 `src/host/main.ts`，创建两个 Project → 退出（退出码 0）→ 重启后 list / get 与退出前一致 → 删除 Workspace 目录再重启，列表仍一致；`user_version` 改为 99 后 Host 退出码为 1，stderr 有 fatal，stdout 为空；stderr 不含 ExperimentalWarning。
- Electron 自带的 Node：用 `frontend/node_modules/electron/dist/electron.exe`（`ELECTRON_RUN_AS_NODE=1`，Electron 44.2.0 / Node 24.20.0，与桌面启动 Host 的方式相同）完成创建 → 退出 → 重启 → 列表一致，无警告输出。
- 未覆盖：没有在桌面 GUI 中点击操作；没有模拟断电；没有在多进程同时写入下测试（设计上不支持）。

## 下一步

F10.1b 节点与 Roadmap 持久保存：在 `events` 中新增 `node` / `roadmap` 两个 domain，用 `storage.atomic` 把 Node 批次、Roadmap 事件与 unlock 合并为一次提交。
