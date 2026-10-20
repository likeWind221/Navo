# BUG-021 / BUG-022：CI 完整套件两项超时

## 现象与复现

2026-10-19，分支 `feature/f13-1a-step-c`。代码 head `c345950` 的 [CI 39269224586](https://github.com/likeWind221/Navo/actions/runs/39269224586) 为 851 通过 / 0 失败；仅追加文档的 `333f094` 的 [CI 39270330070](https://github.com/likeWind221/Navo/actions/runs/39270330070) 为 849 通过 / 2 失败，两项均无断言错误，只有超时：

- BUG-021：`tests/host/process.spec.ts:263` 跨进程续接测试，`Test timed out in 20000ms`，实际 20012 ms。
- BUG-022：`tests/integration/compaction/evidence.spec.ts:29` 证据集成测试，`Test timed out in 5000ms`，实际 5266 ms。

同轮 D1–D8 与 BUG-020 均通过；本轮两项超时与 BUG-020 无关，不归入其修复记录。

## 已证实事实与根因假设

### BUG-021：mock 脚本耗尽触发重试退避

- 成功 run 中该测试 17.969 秒，失败 run 20012 ms；同文件相邻的 standalone 续接测试分别为 18.484 / 19.573 秒，均贴近 20 秒上限。
- 本机修复前阶段计时：第一次 Host 全部完成约 0.58 秒；第二次 Host 中 `continue-main` 28 ms，`continue-node` 14.956 秒。
- 第二次 Host 未传 `NAVO_MOCK_LLM_MODE`，默认 `completed` 只排队 1 个响应；测试却发送 2 个 Turn。第二个请求使 mock 报 `script-exhausted`，经 LLM service 归一为可重试的 `stream-failed`，按 500 ms / 1 s / 2 s / 4 s / 8 s 加抖动重试约 15 秒后失败。
- 原测试未断言续接 Turn 的状态，失败 Turn 仍被判定通过。根因已确认，属于测试夹具与断言缺口，不是 Host 或生命周期内核挂起。

### BUG-022：默认预算过紧

- 成功 run 3.205 秒，失败 run 5.266 秒。
- 本机阶段计时合计约 0.91 秒；耗时集中在 11 个资源发布（约 0.56 秒）、两个 Node 与 Review（约 0.22 秒）；重启约 30 ms。
- `createWorld` 使用 `maxModelRetries: 0`，脚本耗尽会立即抛错，不会产生 BUG-021 的退避；未发现固定等待或锁等待。根因是重的进程内集成测试沿用默认 5 秒预算，与 CI 4 worker 下的波动过近。

## 修复内容

- `scripts/host/mock.ts`：`completed` 模式排队 16 个 completion handler，允许单个 Host 进程服务多个 Turn。
- `tests/host/process.spec.ts`：两个续接测试断言所有续接 Turn 以 `turn-completed` 结束，夹具耗尽不再静默通过。
- `tests/integration/compaction/evidence.spec.ts`：该项显式设置 15 秒单项预算，与同类 compaction 集成测试一致。
- 未修改生产代码；未调整全局超时、未跳过测试、未增加无依据重试。

## 验证结果与边界

Windows / bundled Node 24.19.0；System32 与 bundled Node bin 前置 PATH。

- `pnpm typecheck`：exit 0。
- `pnpm test --maxWorkers=4`：851 通过 / 0 失败，134 文件，282.90 秒。
- `tests/host/process.spec.ts`：25 通过 / 0 失败，260.33 秒。
- `tests/host/process.spec.ts -t "asset crash recovery"`：8 通过 / 0 失败，242.88 秒。
- 两个超时场景定向回归：Host 续接 1 通过，测试 1.13 秒；evidence 1 通过，测试 864 ms。standalone 续接 1 通过，测试 1.02 秒。
- 当前 head `5858f28` 的 [CI 39274751429](https://github.com/likeWind221/Navo/actions/runs/39274751429)：typecheck 通过；851 通过 / 0 失败，134 文件，310.98 秒。原两项超时分别降为 Host 续接 3.623 秒、evidence 2.591 秒，standalone 续接 2.493 秒；D1–D8 全通过。BUG-021 / BUG-022 关闭。

本记录不宣称已覆盖操作系统断电、文件系统硬件故障或其他共享 runner 的整体稳定性；15 秒单项预算只约束该长流程集成测试。

## 后续

修复随原功能分支独立提交并推送，PR #80 保持 Draft，不合并 master。当前 head CI 已通过，本记录与跟踪表已关闭两项；F13.1a 整体仍进行中。
