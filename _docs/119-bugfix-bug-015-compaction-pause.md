# BUG-015：压缩验收观察器漏掉 Node 提交后的暂停时机

> 日期：2026-10-18
> 状态：已定位，修复中；真实完成链路未通过
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

拟在原验收观察器同时监听目标 Node 的 node/event 与 Session 事件，两者都只唤醒对已提交事实的扫描；保留 compactionId 去重与“至少两次成功 pressure + submitted”条件，释放时同时取消订阅。不改生产生命周期，不加轮询或延时猜测。

添加真实 App / AutoRun 的离线回归：先发生两次压力压缩，再由真实 completion 工具提交；断言 AutoRun 在 Main Review 前返回 human-paused、Node 为 submitted、回合已结束，交接材料与重启后显式 start 才继续。回归必须能让旧观察器失败，避免只测试手动 pause。

## 验证结果与边界

- BUG-014 修订的类型检查、专项 13 项及完整 784 项通过；本轮实际 Node JSON 提交与压缩也有效。
- 新的观察器回归及修复验证待填写；本次不追加付费请求。完整真实完成仍待重新授权复验。

## 后续

修复观察器并完成离线专项、本机完整检查，更新原草稿 PR #79；下一次真实复验仍需遵守预算授权，不合并、不关闭本 Bug 或 F12.7 直到满足实际验收。
