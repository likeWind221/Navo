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

## 2026-11-17 BUG-040 分阶段本机排查

仅排查，未修复。CI 原日志显示首次失败的同文件另外两项分别为 3792ms、4593ms，失败项 5170ms；后一次 CI 失败项 5527ms，同文件另外两项为 3059ms、1141ms。日志未记录内部阶段，无法据此判定具体阻塞位置，也无法证明 ENOTEMPTY 的因果关系。

Windows 本机、Node 24、System32 优先、NAVO_TEST_MODE=normal，临时在测试 fixture 与用例中记录阶段耗时，执行 `pnpm exec vitest run tests/integration/library/report.spec.ts --maxWorkers=4 --reporter=verbose`，3 项通过。三项 world 初始化分别为 236.7 / 189.9 / 166.3ms；其中创建应用 48.6 / 26.6 / 23.9ms，导入结束累计 209.4 / 160.7 / 145.1ms，索引等待完成累计 235.9 / 189.6 / 166.1ms；Node 执行结束累计 294.3 / 275.0 / 216.8ms。该计时为本机轻负载单文件基线，不代表 CI 失败时的阶段耗时。临时计时代码已恢复。

结论：来源断言没有被证明失败；测试重复建立真实存储、导入三份资料并等待后台处理，5 秒覆盖整个用例，具备受环境耗时影响的可能，但具体慢点和 CI 根因仍未定位。下一步需在复现 CI 条件时采集对应阶段与清理生命周期证据；不单凭本机数据调大时限或关闭问题。

## 2026-11-17 BUG-040 GitHub CI 单文件诊断

仅排查，未修复。独立临时分支从 master 6e90b30 建立，在测试 fixture 与用例添加阶段计时，临时 workflow 仅手动运行 `NAVO_TEST_MODE=normal pnpm exec vitest run tests/integration/library/report.spec.ts --maxWorkers=1 --reporter=verbose`，Windows runner、Node 24。[运行 44049835475](https://github.com/likeWind221/Navo/actions/runs/44049835475) 的 3 项均通过，用例总耗时依次 2891 / 3582 / 2654ms。

三个用例从开始到 workspace 建立分别累计 305.1 / 476.4 / 235.0ms；资料导入完成分别累计 1763.3 / 1672.5 / 1723.7ms；等待后台处理完成分别累计 2211.3 / 2478.4 / 1959.3ms；Node 执行完成分别累计 2798.8 / 3534.8 / 2613.2ms；清理分别 67.5 / 45.3 / 38.7ms。计时为单次独立运行，不包含与全套测试并发的情形，也不等于之前失败时的具体耗时。资料导入及后台处理在此次运行占明显时间，5 秒余量有限；不能据此认定 CI 负载、I/O 或清理竞争是先前失败根因。未复现超时或 ENOTEMPTY，BUG-040 保持未关闭。

另核对 PR #126 head 192b4eb 的 [CI 44039819504](https://github.com/likeWind221/Navo/actions/runs/44039819504) 显示成功；该通过不自动关闭间歇性问题。临时分支与工作目录仅为诊断，不进入正式 PR。

## 2026-11-17 用户决定

用户决定暂时搁置 BUG-040；根因未明、未修复，保持未勾选。用户要求 CI 完整测试后，对失败测试项单独重试一次；首次失败和重试结果均应保留。该流程是否已交付以实际 CI 配置与合并状态为准。

CI 失败用例单独重试策略已由 PR #127 合入 master（89fb3fa）；Node 24 本地 typecheck、188 文件 / 1166 项、受控重试与错误场景及当前 head CI 均通过。F5.5 开发分支尚未同步该 master 提交。
