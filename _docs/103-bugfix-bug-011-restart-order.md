# BUG-011 重启后节点与资源列表顺序改变

2026-10-15 已在 `fix/bug-011-restart-order` 修复，见文末“修复记录”。

## 现象与复现

F10.5 离线长程场景（`tests/integration/rework.spec.ts`）在第一次重启前后比较 `nodes.getByProject` 时失败：重启前顺序为 evidence、synthesis（创建顺序），重启后 synthesis 排在前面。两个节点的内容逐字段相同，只有顺序不同。资源列表 `resources.listByProject` 的顺序同样会变。

复现：创建同一 Project 下的多个节点或资源，关闭 App 后用同一个数据库文件重新打开，再比较列表顺序。是否改变取决于随机 UUID 的大小，因此并非每次都出现。

## 已证实事实与根因假设

- 已证实：恢复时以 `ORDER BY owner_id, seq` 读取事件（`src/storage/recovery.ts`、`src/storage/database.ts`），owner 即节点或资源的 UUID。各 Store 按读取顺序插入 `Map`，而列表按 `Map` 的插入顺序返回（如 `src/node/store.ts` 的 `getByProject`）。所以重启前列表是创建顺序，重启后变成 UUID 顺序。
- 已证实不受影响：Project 列表 RPC 按 `createdAt` 排序；Mailbox 只有一个 owner，序号连续。
- 影响面（根据代码推断，未在 UI 上观察）：`project.resources` RPC 返回的资源顺序、Main 系统提示中的项目事实（`src/project/session.ts`）、节点上下文里的可见资源、复盘清单里的资源顺序都会在重启后改变。数据本身不受影响；可能的后果是前端列表跳动、模型提示前后不一致。

## 修复内容

无。F10.5 测试暂时按 ID 排序后再比较，并引用本笔记。

## 验证结果与边界

- 在本机 F10.5 场景中观察到节点顺序改变。资源顺序是否改变取决于 UUID，本次未单独构造用例。
- 尚未判断各列表应采用哪种顺序：创建顺序（例如按全局 rowid 或首个事件的时间）还是由调用方显式排序。

## 后续

- 关闭条件：重启前后 `getByProject`、`listByProject` 及依赖它们的 RPC 和模型上下文保持同一顺序；补充重启顺序回归测试；之后把 F10.5 测试中的排序比较改回严格比较。
- 修复从最新 master 新建 `fix/bug-011-restart-order` 分支。

## 修复记录（2026-10-15）

### 现象与复现

同上。修复前把读取顺序临时改回 `ORDER BY owner_id, seq`，新增的两条回归测试与改回严格比较的 F10.5 场景三项全部失败，确认测试能捕获该问题。

### 已证实事实与根因

- 根因已确认：`events` 表按 `owner_id` 排序读取，所有以 owner 为键的 `Map`（Node、Session 等）在重启后都变成 ID 顺序；重启前是 append 顺序。
- 资源列表实际不受影响：资源事件的 owner 是 Project，同一 Project 内按 `seq` 回放，`ResourceStore` 的 `orders` 本来就是创建顺序。排查笔记中“资源顺序同样会变”是推断，未成立。F10.5 中资源排序比较一并改回严格比较。
- 依赖链：`project.resources` RPC（`src/host/project.ts`）、复盘清单（`src/project/checklist.ts`）读 `listByProject`；Main 项目事实（`src/project/session.ts`）、Roadmap 工具视图、Mailbox 读 `getByProject`。它们都直接取 Store 列表，不再各自排序，所以修好 Store 恢复顺序即可。

### 修复内容

- `src/storage/schema.ts` 新增唯一的历史读取语句 `EVENT_HISTORY_QUERY`：`ORDER BY min(rowid) OVER (PARTITION BY owner_id), seq`，即按每个 owner 第一条事件的 rowid（全局写入顺序）排列 owner，owner 内仍按 `seq`。
- `src/storage/database.ts`（`loadEvents`）、`src/storage/recovery.ts`（`readHistories`）、`src/storage/session.ts`（`recoverSessions`）三处原本各写一份 `ORDER BY owner_id, seq`，改为共用该语句，读取顺序只在一处定义。
- 取舍：不新增 `created_at` 列或排序字段，也不改 schema 版本。`events` 是普通 rowid 表，事件只追加不删除，rowid 单调，可直接作为创建顺序。不在各调用方显式排序：调用方很多，且创建顺序正是重启前的既有行为。

### 验证结果与边界

- 本机 Windows，Node v22.23.1（仓库要求 ≥ 24，CI 使用自身版本）：`pnpm typecheck` 通过；`pnpm test` 107 个文件 667 项通过。
- 回归测试：`tests/storage/database.spec.ts`“reopens owners in the order of their first stored event”（交错写入 c、a、c、b、a，重启后顺序为 c、a、b 且与重启前一致）；`tests/node/store.spec.ts`“keeps Project Nodes in creation order after reopening storage”（8 个随机 UUID 节点，重启前后 `getByProject` 完全相等）。`tests/integration/rework.spec.ts` 和 `scripts/rework.ts` 的 `state()` 去掉按 ID 排序，恢复严格比较。
- 边界：schema v1 升级到 v2 时用无 `ORDER BY` 的 `INSERT ... SELECT` 复制，旧库的原始写入顺序可能已丢失，无法恢复，只保证此后重启顺序稳定。若将来对数据库执行 `VACUUM`，rowid 可能被重新编号；当前代码不执行 `VACUUM`。UI 上的列表跳动没有在 Electron 中实际观察。

### 后续

- 关闭条件已满足：重启前后列表与依赖它们的 RPC、模型上下文顺序一致，有回归测试，F10.5 改回严格比较。PR 当前 head 的 CI 结果以 PR 为准，失败则取消勾选。
