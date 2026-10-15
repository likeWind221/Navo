# BUG-011 重启后节点与资源列表顺序改变

仅排查，未修复。

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
