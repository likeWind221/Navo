# 94：F10.3 中断处理

> 2026-10-14。生产实现、本机完整验证、真实 Host 终止 / 重启验收及代码 head CI 已完成；交付见 [PR #58](https://github.com/likeWind221/Navo/pull/58)。

## 做了什么

- 普通、Main、Node Session 在启动恢复时检查持久日志；只要尾部存在 `turn-started` 而没有对应 `turn-ended`，就在 Host ready 前追加确定性的失败收尾。
- 等待模型或消息尚未到达时，追加 `interrupted` 运行时错误；有未闭合 Step 时再追加 `step-ended { status: "failed" }`，最后追加 `turn-ended { status: "failed" }`。
- assistant 已提出但没有 `tool-call-requested` 的调用补 `tool-not-started` 错误结果；已有请求记录但没有结果的调用补 `tool-outcome-unknown`，提示可能已经产生外部副作用，系统不自动重试。
- 所有仍为 `working` 的有效 work Node 在恢复时追加 `work-ended` 回到 `idle`；Session 与 Node 修复事件在同一个 SQLite 事务中提交，失败时整批撤销。
- 实际终止一个等待 Mock 模型的独立 Host 进程，确认数据库中没有 Turn 终态；重启后收尾事件已保存，同一 Session 可由用户显式发起下一 Turn，第二次重启不重复修复。

```text
durable Session / Node histories
  -> validate existing recovery plan
  -> detect open Turn and working Node
  -> plan tool results + failed lifecycle + work-ended
  -> one SQLite transaction
  -> restore projections
  -> Host ready, wait for Human
```

## 关键决策

- `src/session/repair.ts` 只负责从一个已校验 Session 日志推导缺失事件。它按 assistant 工具调用顺序追踪“未开始 / 结果未知”，沿用最后一条真实事件的时间戳，并用 Session ID 与序号生成确定 ID；已闭合或空日志返回空批次。
- `src/storage/interruption.ts` 负责跨领域协调：先为全部有效 Session 规划收尾，再根据恢复后的 Node 投影找出 `working` Node，最后一次性追加两类事件并返回更新后的 RecoveryPlan。它不拥有实时 Turn、AbortController 或 Node 生命周期。
- `src/storage/database.ts` 仍是数据库事务所有者。只有确实存在修复批次时才开启事务；修复提交失败会使 Host 拒绝 ready，不允许以未收口状态继续运行。
- Node 即使对应 Session 已经持久记录正常 Turn 终态，只要 Node 仍为 `working`，也会追加 `work-ended`。这覆盖进程恰好在 `runTurn` 完成后、Node 状态释放前退出的窗口；不会改写 Session 的成功结论。
- Session 收尾保留既有 `failed + interrupted` 契约，不增加新的 Turn 状态，不修改 RPC。合成工具结果进入模型可见 Surface，保证下次 Turn 的上下文没有悬空工具调用；错误码另以既有 `error` 事件保存。
- DeepSeek Harness 固定提交 `d743267388641bc76f17c45ce8b4c231aed1d32c` 的 `packages/core/session/src/repair.ts` 同样保留日志并只补缺失工具结果和生命周期边界。Navo 采用这一机制，但不采用 fork 修复、独立 `interrupted` 终态或“自动判断可重试”；Navo 对结果未知的工具一律不自动执行。
- `src/session/repair.ts` 175 行，职责是一个 Session 尾部的生命周期与工具调用修复；`src/storage/interruption.ts` 86 行，职责是启动恢复的一次跨 Session / Node 原子批次，两者依赖方向单向。既有 `tests/host/process.spec.ts` 超过 300 行，新增场景继续复用同一个 stdio 子进程生命周期边界，没有拆出测试框架转发层。

## 坑与发现

- Host 进程退出已经终止内存中的 Turn；缺少的是持久日志终态。F10.3 不尝试在已退出进程里继续取消，而是在下一次启动、公开 ready 之前补齐事实。
- 工具调用有两个不同风险窗口：只有 assistant 内容时可以确认“未记录执行开始”；已有 `tool-call-requested` 时不能判断外部副作用是否发生，因此必须写成结果未知。
- 跨进程测试最初在子进程已退出后才注册 `exit` 监听，并在死进程 Transport 上等待 `dispose`，触发 20 秒超时。测试 helper 现在先读取 `exitCode / signalCode`，强制终止场景不再向已死亡进程关闭 stdin；这是根据实际失败修正，不改变生产代码。

## 验证结果与边界

- `pnpm typecheck`：通过。
- 专项：`pnpm exec vitest run tests/session/repair.spec.ts tests/session/persistence.spec.ts tests/storage/database.spec.ts tests/host/process.spec.ts`，4 个文件、46 项通过。
- 完整：`pnpm test`，102 个文件、641 项通过；本地执行环境 Node 22.23.1，仓库声明 Node >=24 因而输出 engine warning，SQLite 相关测试仍全部通过。
- [PR #58](https://github.com/likeWind221/Navo/pull/58) 代码 head `750ddf0` 的必需 CI `verify` 成功（1 分 29 秒，含完整 typecheck / test）；最终文档提交仍须通过其当前 head CI 才合并。
- 覆盖：等待模型且消息未收到、普通/Main/Node、工具未开始、工具结果未知、Node Turn 已闭合但状态仍 working、事务回滚、重复启动幂等、真实 Host 终止与跨进程续接。
- 未执行付费模型请求或 Electron 人工验收；中断记录已进入后端 Session 事实，但前端历史查询、会话列表和专门的“中断”视觉样式仍不在本 Step。没有自动续跑、自动工具重试、AbortController 恢复、F10.4 Verification 或数据库迁移。

## 下一步

F10.3 已完成生产实现与代码 head CI，计划、索引和前端交接已收口；PR #58 按最终 head 必需 CI 成功后 squash 合入。下一后端 Step 为 F10.4 验证结论记录，不自动开始。
