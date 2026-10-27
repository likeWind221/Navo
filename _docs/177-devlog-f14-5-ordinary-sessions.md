# F14.5 独立普通会话管理

## 做了什么

- 新增普通会话目录，提供新建、按标题 / 状态分页查找、重命名、归档与恢复；标题、状态、创建 / 更新时间和 revision 持久保存在 `ordinary_sessions`。
- 新增 `session.create.v1`、`session.list.v1`、`session.rename.v1`、`session.archive.v1`、`session.restore.v1`，输入输出严格校验；列表游标绑定目录 revision、查询与状态，目录变化后拒绝旧游标。
- 普通会话目录与 Main / Node 绑定会话分离：绑定会话不进入普通目录，也不能被普通会话接口重命名或归档。
- 回合入口（v1 / v2）与 queued compact 在开始时获取普通会话活动租约；归档检查租约，存在活动或排队工作时不改变状态。归档后旧回合入口被拒绝。
- 启动时把可恢复的 standalone 历史（`project_id = NULL` 且未绑定 Main / Node）迁移为普通会话；打开列表不会创建 Turn 事件，也不会执行历史。
- SQLite schema 升到 9，新增 `ordinary_sessions` 与排序索引；旧 schema 升级路径和既有普通历史保留。

## 关键决策

- 会话元数据与活动租约由同一个目录状态所有者管理，RPC 和 Host 只做校验与转换，不重复保存身份事实。
- 活动租约在请求进入 `AgentInbox` 前获取，因此排队中的 Turn / compact 同样阻止归档；释放只发生一次，异常和取消路径都会清理。
- 列表使用内存目录快照加 revision 游标，不把排序或过滤下推到多个存储接口；目录变化时明确要求重新开始分页，避免重复或遗漏。
- 协议常量从 `rpc/session/ordinary.ts` 导出，`rpc/session.ts` 只重新导出，去掉父模块与子模块之间的运行时循环导入。

## 坑与发现

- 空目录的 `catalogRevision` 必须允许 0，否则首次列表无法通过输出校验。
- 游标只校验 offset 前进不够，还必须校验目录 revision、query、status 和首页长度；空页不能返回停滞游标。
- 迁移必须先于目录加载，并且在 Node 绑定前写入的 standalone 历史不能因为后续绑定而进入普通目录。
- 受控测试需要覆盖真实排队场景：只测目录租约计数不足以证明 Turn / compact 与归档的集成。

## 验证

- `pnpm typecheck` 通过。
- 完整 root 套件 182 个文件 / 1130 项通过，包括新增的普通会话专项、Turn / compact 排队租约、迁移、schema 升级和真实 stdio Host 重启持久化。
- 真实 stdio Host 零推理验收：创建、分页、重命名、归档、重启后读取、恢复均通过；未调用模型。
- `git diff --check` 通过。
- 真实模型和 Electron 页面不在本步骤范围；F5.4 的真实 Main 认证仍受 BUG-036 阻断。
- PR [#118](https://github.com/likeWind221/Navo/pull/118) head `bbc04a7` 的 CI `40444187477` verify 通过（3分57秒），已 squash 合入 `a185778`。

## 下一步

F14.6 原始公开历史与查找导出；F14.5 的桌面页面由前端 F6 / F7 另行消费。
