# F13.1a Step D：真实进程中断与恢复验收

日期：2026-10-19；分支：`feature/f13-1a-step-c`；PR #80 保持 Draft；不合并 master，不实现 F13.1b/c、检索或前端。

## 做了什么

先独立提交 CI 稳定化 `9766763`（[128](128-devlog-f13-1a-ci.md)），只限制 CI 为 4 个 worker。[该 head 的 Actions](https://github.com/likeWind221/Navo/actions/runs/39261284647) 已成功，typecheck 与完整测试通过；确认成功后才开始本 Step 的测试实现。

在现有 `tests/host/process.spec.ts` 中注册真实中断测试，复用 startHost/exitOf/withRealHost/RPC 连接框架。现有正式 Host 测试与新矩阵在同一文件顺序执行，避免两个测试文件争同一真实用户锁。专项入口为 `node node_modules/vitest/vitest.mjs run tests/host/process.spec.ts -t "asset crash recovery"`；此过滤只选择新矩阵，完整 CI 仍运行全部用例。

| 文件 | 职责 |
|---|---|
| `tests/host/process/protocol.ts` | 父子进程的案例、请求和 checkpoint 数据契约，以及固定内容和 operationId |
| `tests/host/process/probes.ts` | 仅在测试子进程内包装真实 fs/SQLite 调用，在准确边界同步输出 checkpoint 并阻塞，等待父进程强杀 |
| `tests/host/process/child.ts` | 取得真实用户锁、启动原 createApp、执行实际 publish/replace 或相同 operationId 重试；只有 interrupt 模式安装测试探针 |
| `tests/host/process/fixture.ts` | 建立真实 SQLite/Workspace/原版本/另一操作的保护资源；只读查询事件并重建投影，联合断言记录、内容、文件及源文件未变 |
| `tests/host/process/interruption.ts` | 父进程到达确认、SIGKILL、自然锁失效、两个正式 Host 重启、RPC 对照和操作重试；失败时收束自己启动的进程 |
| `tests/host/process.spec.ts` | 复用既有子进程框架，允许给测试 driver 传参数，并串行注册矩阵 |

没有修改生命周期生产源码，没有公开崩溃 RPC、环境故障开关或生产测试配置。既有 process.spec.ts 超过 300 行，本次只增加注册与参数传递的 6 行差异；保留历史场景在同一文件以串行使用用户锁，新增的状态编排、子进程、探针与断言均放入所属 process/ 目录，不做无关的历史测试重构。

## 关键决策

- 子进程使用同一 Host 用户锁与 createApp，执行真实资产操作。测试包装发生在 `tests/**`，不复制内核、伪造事件/状态，也不修改持久化数据来制造中断点。所有实际 SQL、文件复制与删除先由原实现执行。
- checkpoint 使用同步 stdout 写入，在 Atomics.wait 中阻塞；父进程收到且验证后调用 child.kill("SIGKILL")。Windows 由 Node 将该信号映射为进程强制终止，不运行正常退出/finally 清理。
- D6 在真实 StatementSync.run 完成 Resource INSERT 后、操作 committed 更新和 COMMIT 之前阻塞。子进程报告 isTransaction=true、事务内有匹配事件；父进程从独立只读连接仍看不到该事件，只看到 prepared 操作。随后强杀，再以新正式 Host 打开同库验证回滚。
- D2 仍运行原 pipeline 和真实 fs.write，只在首个成功写入并 fsync 的块后阻塞；父进程验证暂存大小严格大于 0 且小于 2 MiB，不能用普通抛错代替半复制进程中断。
- D3 在真实 copyFile 调用前暂停，版本目录和归属标记已落地；D4 在目标文件 fsync 后 close 完成时暂停，prepared 尚未写入。D8 在旧 source.md unlink 完成后暂停，清理记录仍未完成。
- 锁等待根据已退出进程的实际锁 mtime 加既有 10 秒 stale 阈值计算；不改时间、不删锁、不把 stale 配置缩短。随后实际执行两次 `src/host/main.ts`，等 ready 后查询 RPC 并验证数据库/文件，再正常结束 Host。
- 前提交中断必须保持原代次，补偿后 failed；后提交中断必须保留新代次，清理后 completed/succeeded。相同 operationId 重试：前者明确失败而不重做，后者返回已有结果；事件数量与文件保持不变。
- 新矩阵最初每例 45 秒，在强化断言复跑中 D7/D8 分别约 47.7/49.4 秒完成所有断言，却被总预算判超时。按实际协议阶段预算相加，改为仅新矩阵每例 120 秒：checkpoint 20 秒、自然锁失效最多约 11 秒、两次 Host 各 ready 15 秒 + exit 15 秒、重试进程 15 秒、fixture/断言/收尾 14 秒。日志还显示 D7 完成信息进入 D8 输出区，说明 Vitest 超时不会自动取消尚在收尾的异步案例；不能把超时后的断言完成当作通过。单阶段既有失败上限不变；增加各阶段实际耗时记录以定位后续性能问题。不调整既有测试或全局超时，不用随机 sleep 制造竞态。

测试包装依据 Node 文档的 [syncBuiltinESMExports](https://nodejs.org/api/module.html#modulesyncbuiltinesmexports) 与 [createWriteStream 的 fs 注入](https://nodejs.org/docs/latest-v24.x/api/fs.html#fscreatewritestreampath-options)。本测试只在隔离子进程内改变绑定并转发到原始实现，恢复 Host 不加载探针。

## 中断矩阵

各例均由父进程 SIGKILL，随后自然等待锁失效并进行两次正式 Host 恢复。测试联合验证事件、操作记录、Resource 投影、RPC、文件内容和存在性；不是只看 execution_state。

| 编号 | 暂停点与可见性证据 | 恢复必须满足 | 实际结果 |
|---|---|---|---|
| D1 | create 意图事务 COMMIT 后，resource_id 仍为空，无 Resource 事件 | 无错误新 Resource；补偿终态 failed | 通过：两次正式恢复及同 ID 重试均通过 |
| D2 | 首个真实暂存块写入后，0 < 大小 < 2 MiB | 原代次有效，半成品不成为当前资产并被清理 | 通过：两次正式恢复及同 ID 重试均通过 |
| D3 | 版本目录/归属标记存在，新 source 尚不存在 | 清理本操作目标与暂存，不动原代次及另一操作资源 | 通过：两次正式恢复及同 ID 重试均通过 |
| D4 | 新目标已复制、fsync、close，操作仍 staging | 不以文件存在推断提交，清理新版本 | 通过：两次正式恢复及同 ID 重试均通过 |
| D5 | prepared 事务 COMMIT 后，业务事务尚未开始 | 保留旧版本，清理未提交新版本 | 通过：两次正式恢复及同 ID 重试均通过 |
| D6 | 真实事务打开，writer 有事件，外部读连接无事件，标记仍 prepared | 回滚事件；旧代次有效；补偿未提交新版本 | 通过：两次正式恢复及同 ID 重试均通过 |
| D7 | 事件与 committed 原子 COMMIT 后，清理尚未开始 | 保留新代次和成功事实，安全清理旧代次 | 通过：两次正式恢复及同 ID 重试均通过 |
| D8 | 旧文件已删除，记录仍 cleanup_pending/succeeded | 幂等完成清理，新代次保留且不误报业务失败 | 通过：两次正式恢复及同 ID 重试均通过 |

所有案例还断言：淘汰版本目录不存在，当前新代次归属标记保留；另一 Resource 的原内容保留；Workspace 用户源文件保留；未提交目标/暂存不残留；第二次启动快照与第一次一致；同 ID 重试后事件数、操作结果和文件仍一致。

## 验证结果与坑

Windows / bundled Node 24.19.0；System32 与 bundled Node bin 前置 PATH。

| 命令 | 实际结果 |
|---|---|
| `pnpm typecheck`（初次新增测试） | 失败：StatementSync.run 重载包装类型与 fs 注入类型的 3 项 TypeScript 错误；已修复测试类型，未改生产代码 |
| `pnpm typecheck`（修正后） | exit 0 |
| `node node_modules/vitest/vitest.mjs run tests/host/process.spec.ts -t "asset crash recovery.*D1 "` | 1 通过 / 0 失败；其余 24 项由专项过滤未执行；28.68 秒 |
| `node node_modules/vitest/vitest.mjs run tests/host/process.spec.ts -t "asset crash recovery"` | 8 通过 / 0 失败；原 17 项由专项过滤未执行；230.74 秒 |
| `node node_modules/vitest/vitest.mjs run tests/host/process.spec.ts` | 25 通过 / 0 失败，含原 17 项及 D1–D8；302.46 秒 |
| `pnpm typecheck`（最终代码） | exit 0 |
| `pnpm test --maxWorkers=4`（目录残留断言增强前） | 851 通过 / 0 失败，134 文件；297.68 秒 |
| `pnpm typecheck`（目录残留断言增强后） | exit 0 |
| D1–D8 专项（目录与当前归属标记断言增强后，最初 45 秒预算） | 6 通过 / 2 超时失败；D7/D8 全部断言最终完成，但分别 47.672/49.374 秒超出总预算；308.83 秒 |
| `pnpm typecheck`（协议预算修正后） | exit 0 |
| `node node_modules/vitest/vitest.mjs run tests/host/process.spec.ts -t "asset crash recovery"`（120 秒协议预算） | 8 通过 / 0 失败；原 17 项由专项过滤未执行；255.88 秒 |
| `pnpm test --maxWorkers=4`（最终协议预算与断言） | 851 通过 / 0 失败，134 文件；346.99 秒 |

## 下一步与边界

矩阵与回归已完成，Step D 单独提交并推送至原分支，保留 Draft PR #80 等待人工审核。Step E 合并未授权，F13.1a 整体保持进行中。本矩阵验证用户指定的八个进程中断点；不宣称覆盖操作系统断电、文件系统硬件故障或所有指令级崩溃时刻。
