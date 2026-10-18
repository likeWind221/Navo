# BUG-015：压缩验收观察器漏掉 Node 提交后的暂停时机

> 日期：2026-10-18
> 状态：观察器已修复，本机完整验证通过；授权复验进程中断，缺少完整结果，未关闭
> 跟踪：[bug-plan.md](bug-plan.md)；阶段：[117](117-devlog-f12-7-acceptance.md)；前置修订：[118](118-bugfix-bug-014-compaction-acceptance.md)

## 现象与复现

用户授权 BUG-014 JSON 交接修订后，使用 gpt-6-luna 运行一次真实验收。128684ms、16 次请求后第一阶段以 review-escalated 停止，期望的 human-paused 没有发生；脚本失败退出，未重跑。

- Node A 已读取十批材料，并通过 submit_completion 提交 JSON。用现有 validateSummary 和独立生成的 expected 只读核对，结果 ok=true，包含 80 条记录、总和 3958、20 个异常及全部逐批数值与异常 ID。
- 同一 Node Session 两次 pressure 压缩成功：36767→17267、37475→17267。
- 尚未执行材料交接和重启；Main 已先行审查，因工作日志节选截断、尚无可读取 Resource 而明确 escalate。下游 Node B 保持 locked。
- 证据：`C:/Users/likeW/AppData/Local/Temp/navo-f127-luna-20261018-1546/`，含 failure.json、preflight.json、submission-diagnostic.json。
- 日志：`C:/Users/likeW/AppData/Local/Temp/navo-f127-luna-20261018-1546-run.log`。
- 数据库：`C:/Users/likeW/AppData/Local/Temp/navo-f127-storage-LDpWUG/navo.db`。
- Workspace：`C:/Users/likeW/AppData/Local/Temp/navo-f127-workspace-cnWg0A`。

## 已证实事实与根因假设

- 根因置信度高：`scripts/compaction/watch.ts` 仅监听 session/event，但新增条件要求 Node status=submitted。
- `src/node/session.ts` 先等待 AgentRuntime.runTurn 返回，再在 finally 中调用 nodes.endWork；因此 Session 的 turn-ended 已发布时，Node 仍是 working，completion-signaled 尚未转为最终 submitted。
- `src/node/store.ts` 的 endWork 提交 work-ended 后通过 node/event 通知；原观察器未监听这个真实生命周期边界，之后没有目标 Session 事件唤醒它。
- Main 的升级不是模型无故失败，而是在验收脚本尚未提供下游材料时被提前启动。不能手动改成 complete，也不能将本轮当作整个 F12.7 已通过。

## 修复内容

原验收观察器现已同时监听目标 Node 的 node/event 与 Session 事件，两者都只唤醒对已提交事实的扫描；保留 compactionId 去重与“至少两次成功 pressure + submitted”条件，释放时同时取消订阅。不改生产生命周期，不加轮询或延时猜测。

添加真实 App / AutoRun 的离线回归：先发生两次压力压缩，再由真实 completion 工具提交；断言 AutoRun 在 Main Review 前返回 human-paused、Node 为 submitted、回合已结束，交接材料与重启后显式 start 才继续。回归必须能让旧观察器失败，避免只测试手动 pause。

## 验证结果与边界

- BUG-014 修订的类型检查、专项 13 项及完整 784 项通过；本轮实际 Node JSON 提交与压缩也有效。
- `tests/integration/compaction/watch.spec.ts` 使用真实 App / AutoRun：旧观察器实际返回 roadmap-complete、mainTurns=1，未按期暂停，因此断言失败；修复后返回 human-paused、mainTurns=0，Node 已 submitted，无活跃回合。随后原样交接、重开同一 SQLite，确认零新增请求与完整状态一致；显式 start 后真实离线 Main Review 完成。
- Windows / bundled Node 24.19.0，System32 与 bundled Node 前置 PATH：类型检查通过；完整测试 127 文件、785 项全部通过，52.03 秒。
- 用户明确回复“授权再复验一次”，授权修复后再使用 gpt-6-luna 运行一次，仍为最多 20 分钟、48 请求（含摘要）；无自动重跑。新证据目录为 `C:/Users/likeW/AppData/Local/Temp/navo-f127-luna-20261018-rerun-1555/`。
- 这次执行由 Claude Code background task `b5oebdy3o` 启动，日志停在第 10 次请求 started（含两次摘要请求）；核对时 CLI 与验收 Node 进程均已不存在，证据目录仅有 preflight.json，没有 final / failure / handoff / restart 报告，未获得退出码或可确认的退出原因。不能把 started 请求计成成功响应，不能把缺失报告计为模型或观察器失败，更不能标为通过。
- 只读保留现场：数据库 `C:/Users/likeW/AppData/Local/Temp/navo-f127-storage-fGYuhZ/navo.db`，Workspace `C:/Users/likeW/AppData/Local/Temp/navo-f127-workspace-foXuAY`，日志为上述证据目录同名 `-run.log`。本轮未重新启动、未运行恢复逻辑写入现场。
- Claude Code 随后通过 `node:sqlite DatabaseSync({ readOnly: true })` 提取持久事实，Codex 核对原始查询输出并将诊断存为 `interruption-diagnostic.json`（不是验收成功报告）。两次 pressure 均 completed：38342→18345、32806→11090；Node A 仅有 work-started、无 completion-signaled / work-ended，Node B locked，Main 无 Session 事件。目标 Session 最高序号 53 为 llm-requested，Turn 未结束，最后请求无持久响应；10 次 started 包含 8 次任务与 2 次摘要。中断时尚未触及观察器的 submitted 条件，所以本轮不能验证或否定暂停修复。

## 后续

更新原草稿 PR #79，保留未完成状态；不合并、不关闭本 Bug 或 F12.7。下一次真实执行须另获授权，并保持执行进程存活直到收集退出结果；不能自动重跑来补足本轮缺失证据。
