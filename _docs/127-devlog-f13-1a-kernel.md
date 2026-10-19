# F13.1a Step C：共享资产生命周期内核

日期：2026-10-19。基线：`a6e1063`。分支：`feature/f13-1a-step-c`。

## 做了什么

按 [v1.3 设计](126-devlog-f13-1a-design.md) 实现 Step C。代码与本地验证完成，提交分支等待人工审核；F13.1a 保持进行中，未进入 Step D 的完整故障验收或 Step E 合并。此次共享控制面由 Codex 单独串行维护，未委派其他 Agent。

| 模块 | 文件与职责 |
|---|---|
| 存储 | `src/storage/schema.ts` 单向 v1/v2 → v3；`operations.ts` 提供 STRICT 操作表、约束与事务查询；`database.ts` 将同连接 transaction 传给 atomic 回调 |
| 事件事实 | `src/resource/model.ts` 增加 libraryPath/assetGeneration 和内部替换输入；`events.ts`、`history.ts`、`projector.ts` 使用 v4 创建/替换/删除事件并回放；`src/storage/recovery.ts` 显式拒绝旧 Resource 格式，不把它当作普通 Project 损坏 |
| 入口与内核 | `src/resource/publication.ts` 保留 Workspace 来源授权、默认根目录与重名编号；`lifecycle.ts` 统一创建、替换、删除、幂等请求、提交边界与读取租约；`service.ts` 保留领域门面并接入限额配置 |
| 文件与清理 | `src/resource/assets.ts` 受控目录、排他版本准备、大小限制与精确清理；`library.ts` 逻辑路径规范；`path.ts` Workspace 来源与固定版本定位；`recovery.ts` 对照事件恢复、检查代次与租约并持久化清理进度 |
| Host 与工具 | `src/host/lock.ts` 用户级 proper-lockfile 锁；`main.ts` 锁在数据库前取得并在退出时释放；`src/app.ts` 在工具/RPC 可用前恢复；`fetch.ts` 用租约回调读取；`delete.ts` 等待清理尝试并移除永久保留文件的旧提示 |
| 测试 | 新增 `tests/storage/operations.spec.ts`、`tests/resource/assets/helpers.ts` 与该目录的 `flow.spec.ts`、`recovery.spec.ts`、`path.spec.ts`；更新现有 Resource、工具、迁移与 Host 进程测试，保留旧场景的权限/事务断言 |

未修改 Renderer、Electron Bridge、公共 RPC、根包清单或锁文件。未实现 User owner、用户导入、目录/批次编排、正文处理、Embedding、检索及新的 Agent 工具。`replace()` 只是内部领域入口。

## 关键决策

1. **一份事实、一条事务。** Resource 事件继续是业务事实；操作表只记录意图、请求身份、代次、受控位置、业务结果和执行进度。`atomic(tx => ...)` 使用原连接；ResourceStore 的内存投影仍延迟到事务提交后应用。没有把异步复制放进 SQLite 事务。
2. **先准备再提交。** 授权来源后先插入 resource_id 为空的新建意图，再持久化分配的 ID；暂存成功后准备 `assets/<id>/versions/<generation>/source.<ext>`，最后原子提交事件与 committed。替换不改名称、描述、逻辑路径、owner 或访问范围；最终再次验证 expectedRevision。扩展名使用安全的小写字母数字后缀，无此后缀时文件名为 `source`。
3. **操作身份与目标归属。** `request_json` 是设计最低字段之外的请求绑定信息，保留 actor、来源引用与元数据，拒绝同 ID 换输入；不保存第二套当前 Resource 状态。部分唯一索引排他保留 resourceId/targetGeneration；不可变版本目录中的 `.operation` 只记录归属 operationId，防止补偿清理竞争操作的文件，不是内容哈希或签名。版本排他创建，文件准备后 flush；进程在目录创建和归属标记之间退出时，只修剪空目录，不删除未知文件。
4. **同步读取边界。** 状态/权限检查与 generation 租约登记是同一个不含 await 的同步区段；替换、删除提交也不含 await。清理检查当前代次和租约后只处理不可重新成为当前引用的旧版本，新的租约不会再登记到该旧代次。`withEntry()` 无论成功、失败或取消都会 finally 释放并尝试清理。低层 `resolveEntry()` 返回 release，直接调用者负责释放；实际 Agent fetch 已改为 `withEntry()`。删除不撤销在途读取，权限不在交付前复验。
5. **业务结果和清理分开。** 清理失败保存 cleanup_pending，不覆盖 succeeded/failed/cancelled。若连清理进度写入也失败，已提交的 committed 记录仍可被 pending 查询恢复，调用方保持原业务结果。数据库无法写入时不能声称已写出 cleanup_pending。未提交失败项恢复为 failed，取消项恢复为 cancelled，不自动重读来源或重跑 Agent。
6. **来源与命名在入口。** AssetIntake 接收可信来源解析函数，内核不授权任意绝对路径。Agent 入口提供 Workspace 限制和编号策略；内核在事务里规范化并校验最终路径唯一性。NFC + toLowerCase + NFC 是统一 key；不依赖平台大小写行为。源路径保留真实文件名，逻辑路径单独 NFC 规范化。
7. **限额与单实例。** 默认单文件 100 MiB；`NavoAppConfig.resources.maxFileBytes` 可在 1 字节至 100 MiB 内收紧，复制前和复制中均检查。批次 500 文件/1 GiB、深度 32、4 并发的编排由 F13.1c 落实。本机 OS 用户锁位于原生 userInfo().homedir 下 `.navo-host.lock`，不随 NAVO_HOME/Workspace 改变；stale 10 秒、update 2 秒，不轮询争锁，不增加清理常驻服务。
8. **模块边界复核。** `publication.ts` 虽短，拥有 Agent 的来源和命名策略，不能与共享保存策略混成一条入口；`lock.ts` 独立拥有进程生命周期边界。Service 保留领域访问/元数据与 Store 装配，Lifecycle 编排资产操作，Recovery 拥有清理任务与租约计数；未为短文件新增 barrel 或转发目录。

Harness 只读参考固定到 `687f282e8625c6b8d11ff58211a90524be2e4317` 的 [packages/core/agent-loop/src/tool-calls.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/tool-calls.ts)：保留取消后收束已启动工作、结果归属明确的原则；Navo 本次是单文件补偿/事件事务，不移植其工具并发池、有序工具结果提交或自主唤醒机制，不能声称 Harness 已提供本资产内核。

## 坑与发现

- v1.3 的第 4、10 节明确拒绝旧 Resource 格式，但旧验收段仍残留“旧 v3/代次 0 兼容”描述。本次遵循明确冻结契约，既不增加旧布局分支，也不自动删除旧文件；旧资源数值格式版本在 Storage 恢复时明确失败。普通 Project/Session/Node 继续原迁移路径。
- Cordis 的插件装配上下文不能直接访问未 inject 的 resources；恢复改为有明确 inject 的 ResourceRecovery 插件，并等待它完成。
- 原删除测试改为验证逻辑不可访问和安全物理清理，没有删除原来的 CRUD/权限/事务场景。
- 末次完整测试前的默认并行运行中，未修改的 HTTP pinned connection 测试发生一次 5 秒超时；单独运行该文件 7/7，通过限制 Vitest worker 数运行全部测试也通过，未改生产网络代码或测试超时。并行负载是可能原因，未据此确认新的业务 Bug。

## 验证与边界

Windows；bundled Node **24.19.0**。每个命令前在 PowerShell 将 `C:\Windows\System32` 与 bundled Node 的 bin 置于 PATH 最前。默认 Node 22 未用于验收。pnpm 的现有 package.json 配置迁移警告没有影响本轮检查，未顺手修改依赖配置。

| 实际命令 | 通过 / 失败 | 结果与关键失败 |
|---|---|---|
| `node node_modules/vitest/vitest.mjs run tests/storage/schema.spec.ts tests/storage/database.spec.ts tests/resource tests/tools/resource`（首次） | 35 / 20 | 原型接入时的 Cordis inject 错误、旧布局与永久保留断言；均已修复或按新语义更新 |
| 同上（第二次） | 54 / 1 | 最后一处旧工具删除后读取文件的断言；已更新为 ENOENT |
| `node node_modules/vitest/vitest.mjs run tests/storage/schema.spec.ts tests/storage/database.spec.ts tests/storage/operations.spec.ts tests/resource tests/tools/resource` | 97 / 0 | 初始新增操作/生命周期测试通过 |
| `node node_modules/vitest/vitest.mjs run tests/host/process.spec.ts` | 17 / 0 | 正式 Host 不同 NAVO_HOME 争锁、EOF 释放、SIGKILL 后失效锁恢复及原进程回归 |
| `node node_modules/vitest/vitest.mjs run tests/storage tests/resource tests/tools/resource`（增补后两次） | 101 / 0；103 / 0 | 增补竞态、清理数据库写入失败、字节边界与空版本目录恢复 |
| `pnpm typecheck`（最终代码） | 成功，exit 0 | 类型检查，无运行时正确性推断 |
| `pnpm test`（默认并行） | 836 / 1 | pinned HTTP connection 超过 5000ms；未修改该文件 |
| `node node_modules/vitest/vitest.mjs run tests/tools/fetch/network.spec.ts` | 7 / 0 | 单独复跑，97ms 测试时间 |
| `pnpm test --maxWorkers=4`（增补前） | 842 / 0 | 完整后端套件 |
| `pnpm test --maxWorkers=4`（最终代码） | **843 / 0，134 文件** | 完整后端套件，50.87 秒 |

对用户要求的十项场景：

| 场景 | 证据 |
|---|---|
| 1. v2→v3、操作 CRUD/状态约束 | `tests/storage/operations.spec.ts`；原 `schema.spec.ts` 继续覆盖 v1 普通业务升级 |
| 2. 创建/替换/删除 | `tests/resource/assets/flow.spec.ts`，验证事实、内容、身份与代次 |
| 3. 事务失败 | operation committed 更新触发器中断，断言事件与标记均回滚；既有持久化测试继续覆盖事件写失败 |
| 4. 重复操作 | 同时/先后重试创建、替换、删除，验证事件数；同 ID 换输入拒绝 |
| 5. 路径与并发重名 | 23 项非法路径，实际 NFC/大小写源文件、4 个并发发布与扩展名前编号 |
| 6. 读取/替换 | Promise 同步点固定旧代次，替换后旧读取与新读取分别读取原/新内容 |
| 7. 读取/删除 | 新读取拒绝、在途读取完成才清理；额外覆盖替换准备时删除与两个替换争同代次 |
| 8. 清理恢复 | 文件清理失败、清理进度 SQL 写失败、未提交 staging/prepared、标记前空目录、取消和资产缺失；关闭 Context 后重新打开同库恢复 |
| 9. 两个正式 Host | `tests/host/process.spec.ts` 真正启动两个进程；第二个在打开自身数据库前退出；强杀首进程后将其锁 mtime 设置为过期，再验证重启 |
| 10. Agent 回归 | 原 Resource/tool/access/handoff 与完整 843 项后端测试通过 |

设计 v1.3 第 10.1 节逐项对照：1 仅 Main/Node、User 延后；2 Schema/同事务已实现；3 旧 Resource 明确失败、普通业务保留迁移；4 路径和提交冲突检查已实现；5 方案 B 已实现；6 正式 Host 用户锁已实现；7 启动/后续操作恢复已实现、无后台服务；8 单文件限额已实现，批次默认值交接 F13.1c；9 单文件边界已实现，无用户批次编排。

未解决的验收范围：Step D 尚须完整执行各关键步骤的真实进程中断/重启矩阵；本轮生命周期故障主要是可控异常与重建持久化中断状态，不能代替真实崩溃全覆盖。Host 锁测试通过修改已退出进程的锁 mtime 模拟过期，没有实等 10 秒。没有真实模型、Renderer、Electron Bridge、用户资料或检索验收。F13.1a 整体保持未完成。

## 下一步

提交并推送本功能分支，创建 PR 等待人工审核；按本次用户指令不合并、不清理分支，不自动开始 Step D、E 或 F13.1b/c。当前交付的实现和实际边界以本文与最终代码导读为准。
