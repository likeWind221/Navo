# BUG-020：文件版本分页测试前提

## 现象与复现

2026-10-19，分支 `feature/f13-1a-step-c`，Step D head `9ea789d` 的 [CI 39267061717](https://github.com/likeWind221/Navo/actions/runs/39267061717) 为 850 通过 / 1 失败。失败位于 `tests/tools/file/concurrency.spec.ts:93`：预期拒绝覆盖，实际写入成功。这是断言失败，不能归为超时。D1–D8 在同轮 CI 均通过。跟踪入口：[BUG-020](bug-plan.md)。

## 已证实事实与根因假设

- 两份测试内容长度相同，连续 `writeFile` 复用同一文件对象，没有确保 mtime 不同。
- 既有 [Phase 8 契约](21-devlog-phase-8-file-tools-plan.md) 明确使用 `dev:ino:size:mtimeNs`，非内容摘要；生产实现完全遵循这一契约。若这些字段相同，分页观察被视为同一版本。
- 原 CI 未输出两次 stat，不能追认原始 mtime 相同为现场测得事实；时间碰撞符合实现和失败表现。可以确认测试缺少“不同 token”的必要前提。本次不扩展为识别相同元数据的任意外部内容变更，也不增加内容哈希。

## 修复内容

仅修改原分页回归：两次实际写入后分别 `utimes` 为相差 2 秒的固定时间，并通过 `probeFile` 断言 token 确实不同，再执行第二页读取。保留原覆盖拒绝和文件内容不变断言，没有跳过、重试、随机等待或放宽超时。这里操作的是测试临时文件，与 Step D 用户锁时间完全无关；真实中断矩阵仍等待锁自然过期。

## 验证结果与边界

Windows，bundled Node 24.19.0，System32 与 bundled Node bin 前置 PATH。

- `node node_modules/vitest/vitest.mjs run tests/tools/file/concurrency.spec.ts`：5 通过 / 0 失败，621 ms（随后把前提断言收紧为直接比较 token）。
- 最终 `pnpm typecheck`：通过，无 TypeScript 错误。
- 最终 `pnpm test --maxWorkers=4`：851 通过 / 0 失败，134 文件，365.15 秒，含收紧后的 token 前提断言及全部 D1–D8。
- 修正代码 head `c345950` 的 [GitHub CI](https://github.com/likeWind221/Navo/actions/runs/39269224586)：typecheck 与完整 851 项均通过，0 失败，D1–D8 均通过。

## 后续

修正随用户指定的原功能分支独立提交，不另开或合并 master；PR #80 保持 Draft。本机完整及修正代码 head CI 均通过，BUG-020 关闭；PR 仍待人工审核。本记录不把 stat freshness 升级为跨进程原子内容 CAS，也不宣称硬件故障或断电已验收。
