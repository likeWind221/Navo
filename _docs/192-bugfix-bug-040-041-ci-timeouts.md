# BUG-040 / BUG-041：F5.5 CI 后端测试超时

## 现象与复现

2026-11-17 PR #126 代码 head f076683，CI run 44037466017 常规测试失败：

- BUG-040：tests/integration/library/report.spec.ts 的 accepts sources observed beyond the two originals fetched in the Turn 超过 5000ms；收尾又报 workspace/.navo 的 ENOTEMPTY。
- BUG-041：tests/resource/assets/path.spec.ts 的 allocates different normalized paths to concurrent Agent publications without changing display names 超过 5000ms。

常规测试 1155 通过 / 2 失败，崩溃恢复检查未执行。失败日志保存在 `%TEMP%/navo-f55-ci-failed.log`；[原 CI](https://github.com/likeWind221/Navo/actions/runs/44037466017)。

## 已证实事实与根因假设

本次只改 frontend 与文档，根 src/tests/package/lock 均未改动。本机 Node24.22.1 完整188文件/1166项通过；失败后两文件定向32项复验通过（4.21秒）。证据不能确定 CI 调度、I/O 或夹具生命周期哪项是根因；ENOTEMPTY 可能与超时后仍在处理的任务有关，但尚未证实。

## 修复内容

仅排查，未修复。不修改后端代码或测试预算、不绕过 CI。两个问题分别保持未勾选；相关后端修复须按所有权另行交接。

## 验证结果与边界

命令：Node24、PATH 首项 System32，pnpm exec vitest run tests/integration/library/report.spec.ts tests/resource/assets/path.spec.ts --maxWorkers=4，32项通过。同提交 CI 复跑结果随后追加；复跑通过不自动证明这两个问题已修复。

## 后续

若再次出现，保留分阶段耗时与清理时的任务状态，按证据定位。关闭条件：确认根因及必要修复，相关场景、本机完整与当前head CI通过；单次复跑不关闭。入口：[Bug 跟踪表](bug-plan.md)。

同日同一代码head f076683的 CI attempt 2 通过（verify 3m50s，常规与崩溃恢复均通过）。没有修改后端源码或测试，没有增大时限；两项仍未关闭。
