# 165：F14.1 项目原会话与中断事实公共交接

日期：2026-10-26。状态：开发与验收进行中；未完成，未合并。

## 做了什么

用户明确授权将完成前端 F6–F11 所需后端能力纳入连续目标。后端子 Agent 在独立 worktree `D:/Program/Navo-f14.1`、分支 `phase14-f14.1-session-recovery` 实施会话恢复只读公共查询；主编排 Agent 为共享控制面唯一写入者。

目标是按真实 Project / Node 所属关系取得原 Session 与最近已保存 Turn 的可信状态及中断原因，区分未建立和不可读取。读取不运行回合、不新建会话、不重放工具；不修改前端页面，不新增普通会话管理或自动运行观察。

## 关键决策

通过独立版本化公共查询交付，不改变当前严格 NodeV1 的格式；输入、输出、错误和取消均需在公共边界验证，旧 API 保持兼容。前端消费仍由 F6 实施并验收，不能把本步完成视为页面恢复完成。

## 坑与发现

现有 Node 快照只有 hasSession；Main 已公开身份。中断修复已持久化，但未公开查询。代码审查特别核对当前活动回合不能误报上一回合完成、Session 所属关系与真实存在性。

## 验证结果与边界

Windows PowerShell / bundled Node 24.22.1，System32 与 Node 24 位于本进程 PATH 前。`node node_modules/typescript/bin/tsc --noEmit` 通过；`NAVO_TEST_MODE=all node node_modules/vitest/vitest.mjs run --maxWorkers=4`：167 文件 / 1065 项全部通过，267.47 秒，包含完整进程恢复组。子 Agent 定向 RPC / Host / Follow / Turn 20 项与持久化 / 重启相关 42 项通过，主编排已审查实际 diff。

主编排独立启动正式 `src/host/main.ts`，经 NDJSON stdio 创建临时项目、读取新查询、关闭 Host 后重开同库再查：Project 与 Main Session 身份、available 状态和空 lastEndedTurn 完全一致，0 生成 / 0 Embedding。真实现场 `%TEMP%/navo-f141-host-s3aa78e3` 保留；证据位于本会话可视化目录 `f141/host.json`，完整日志 `f141/typecheck.log` / `f141/full.log`。

真实 Host 检查只证明正式进程注册、传输和重启身份保持，不冒充 Renderer 恢复验收。Node 未建立 / 空绑定 / 不可读、跨项目归属、持久库中断修复和压缩中断分别由针对性测试覆盖；未调用真实模型。当前 PR / CI 仍待完成，不标记步骤全部完成。

## 下一步

子 Agent 完成后由主编排 Agent 审查与验收并串行合并，前端 F6 后续消费；代码导读尚未交付。

## 模块与实际处理

- `rpc/project/session.ts` 是公共入口，声明 `project.session.recovery.v1` 与恢复条目联合类型。`unestablished` 表示 Node 尚未绑定，`available` 携带原 Session ID 和可空的 `lastEndedTurn`，`unavailable` 表示持久恢复已判不可读取。`lastEndedTurn` 只描述最近已结束回合；当前是否活动仍以既有 Project 快照为准。
- `rpc/project/session/validation.ts` 校验精确字段、身份字符串、时间戳、终态和中断原因；独立于原 Project 的大型校验文件。契约入口的单结果校验器拒绝空响应及重复响应。
- `src/host/project/session.ts` 的 `createProjectSessionRecoveryHandler` 先按公开项目引用获取 Project，再读取 Main 绑定及 `getByProject` 下的 Node 绑定；读取前和循环中检查取消。`describeSession` 优先检查恢复不可读集合，否则读取原 Session 事件；已有但无事件的绑定保持 available，不把空历史当未建立。
- `lastEndedTurn` 从后向前找真实 `turn-ended`，再关联匹配的 `turn-started` 取得开始时间；缺失开始事件直接失败，不补造时间。`findInterruption` 仅在该 Turn 边界内读取：同 Turn 的 interrupted 压缩终态优先返回 context-compaction，否则真实 interrupted 错误返回 host-stopped，普通失败不冒充中断。
- `src/host/project.ts` 将查询注册到现有 Host；`rpc/project.ts` 沿用包级公开出口。未改变旧 NodeV1、既有回合、存储修复或前端格式，前端尚未接入此新方法。

例：重启前已有 Node Session 且 Turn 未闭合，存储恢复补记失败与 interrupted 错误；本查询返回原 Session、失败终态与 host-stopped，不再次执行该 Turn。尚未开始过的另一 Node 返回 unestablished。

现有 `rpc/project.ts` 作为包级公共协议入口已超过 300 行，本步仅追加新公共出口，保留原因是维持既有消费路径和公开协议兼容；恢复类型、运行时校验与 Host 实现分别独立，未继续扩张原大型 Project 校验文件。
