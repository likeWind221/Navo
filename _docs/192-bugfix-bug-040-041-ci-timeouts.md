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

## 文档 head 452477c 后续失败与 BUG-042

run 44038651088 attempt 1：report.spec.ts:33 的 rejects a correct-looking answer that lists real source IDs without actually reading the sources 再次超过5000ms；日志 `%TEMP%/navo-f55-ci-final-failed.log`。

attempt 2：1150通过/7失败，以下场景超时，日志 `%TEMP%/navo-f55-ci-final-attempt2.log`：tests/host/resource.spec.ts:54、tests/integration/autorun.spec.ts:48、tests/integration/embedding.spec.ts:17、tests/storage/operations.spec.ts:28、tests/integration/compaction/pressure.spec.ts:27、tests/project/context/recovery.spec.ts:24 各5000ms；tests/integration/compaction/evidence.spec.ts:29 为15000ms。

将本轮跨多个既有后端套件的超时现象统一登记 BUG-042，P2，所属端为后端测试/CI；尚不能证明共享根因，也不能单凭分散超时确认是 runner 负载。未修改代码、未放宽断言或时限。关闭条件：定位超时来源，按证据修复并通过本机完整与当前head CI；单次复跑不关闭。不是对既有 BUG-022 修复根因的反证，暂不覆盖其历史关闭事实。

当前状态：F5.5正式界面、本机验证和受控Electron验收已完成，但当前提交CI未通过；保持PR未合并与F5.5进行中。前端所有者不跨界修改后端src/tests或根测试设置，停止自动复跑，交接后端测试排查。代码导读在本次交付中提供；F5.6a未开始。
