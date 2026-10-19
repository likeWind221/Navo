# F13.1a：CI 超时复盘与修复

日期：2026-10-19；分支：`feature/f13-1a-step-c`；PR #80 保持 Draft，不合并 master。

## 做了什么

Step D 代码 head `c345950` 的 [CI 39269224586](https://github.com/likeWind221/Navo/actions/runs/39269224586) 类型检查与完整 851 项测试通过。随后仅文档收尾的 `333f094` 的 [CI 39270330070](https://github.com/likeWind221/Navo/actions/runs/39270330070) 为 849 通过 / 2 失败，两项均为超时：

- `tests/host/process.spec.ts:263`：`continues Main and Node contexts across separate Host processes without replaying tool side effects`，20012 ms，上限 20000 ms。
- `tests/integration/compaction/evidence.spec.ts:29`：`publishes source-linked excerpts privately, preserves exact RECORD lines and survives restart`，5266 ms，默认上限 5000 ms。

同一轮 D1–D8 与 BUG-020 均通过；本轮两项超时与 BUG-020 无关。

## 根因证据

### Host 跨进程续接测试

成功 run 中该测试为 17.969 秒，失败 run 为 20012 ms；同文件紧随其后的 `continues standalone Sessions with tool records across separate Host processes` 分别为 18.484 秒 / 19.573 秒，两项长期贴在 20 秒上限附近。

在修复前对本机同一测试加入阶段计时，得到：

```text
host1-start 3ms -> host1-ready 418ms -> host1 完成 576ms
history1 582ms -> host2-start 584ms -> host2-ready 992ms
host2-main 1033ms -> host2-node 15989ms
```

第二次 Host 的 `continue-node` 单次耗时约 14.956 秒，其余 RPC 均为毫秒级。原因不在业务内核：

- 第二次 Host 没有传 `NAVO_MOCK_LLM_MODE`，走默认 `completed`；该模式只排队 1 个 mock 响应。
- 但测试在第二次 Host 中先后发送 `continue-main` 与 `continue-node` 两个 Turn，第二个请求耗尽 mock 脚本。
- `script-exhausted` 经 LLM service 归一为 `stream-failed`，属于可重试失败；运行时按 500 ms、1 s、2 s、4 s、8 s 加抖动退避，累计约 15 秒后 Turn 失败。
- 原测试只比较 mailbox、resources 和会话事件前缀，没有断言续接 Turn 成功，因此失败 Turn 仍然通过，并把整个测试推到 20 秒上限；CI 的额外负载使其越界。

### evidence 集成测试

成功 run 中该测试为 3.205 秒，失败 run 为 5.266 秒。本机阶段计时（修复前）：

```text
world 12ms -> open 48ms -> dataset 55ms -> project 617ms -> batches 643ms
restart-start 645ms -> restart-open 675ms -> restart-done 677ms
turns 897ms -> report 903ms -> done 910ms
```

`createWorld` 明确使用 `maxModelRetries: 0`，ScriptedAdapter 耗尽时立即抛错，不会进入上面的 15 秒退避；`world.restart` 仅约 30 ms。该测试包含 11 个资源发布、应用重启、两个 Node 与两次 Review，属于较重的进程内集成测试。默认 5 秒预算与 Windows 共享 runner 在 4 worker 下的波动过近，未发现固定等待、锁等待或隐藏重试。

## 修复内容

- `scripts/host/mock.ts`：`completed` 模式改为排队 16 个相同的 completion handler，与既有 `session-context` 模式一致，允许一个 Host 进程服务多个 Turn。
- `tests/host/process.spec.ts`：两个跨进程续接测试分别断言 `continue-main` / `continue-node` 与 `continued` / `separate` Turn 以 `turn-completed` 结束；夹具再次耗尽时会直接失败，不再静默通过。
- `tests/integration/compaction/evidence.spec.ts`：为该项长流程显式设置 15 秒单项预算，与 `overflow`、`pressure`、`watch` 等同类集成测试一致。
- 未修改生命周期或 Host 生产代码；未提高全局超时、未跳过测试、未增加重试。

## 验证

Windows / bundled Node 24.19.0；System32 与 bundled Node bin 前置 PATH。

| 命令 | 实际结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm test --maxWorkers=4` | 851 通过 / 0 失败，134 文件；282.90 秒 |
| `node node_modules/vitest/vitest.mjs run tests/host/process.spec.ts` | 25 通过 / 0 失败；260.33 秒 |
| `node node_modules/vitest/vitest.mjs run tests/host/process.spec.ts -t "asset crash recovery"` | 8 通过 / 0 失败；242.88 秒 |
| `node node_modules/vitest/vitest.mjs run tests/host/process.spec.ts -t "continues Main and Node contexts"` | 1 通过 / 0 失败；测试 1.13 秒（修复前本机 18.32 秒） |
| `node node_modules/vitest/vitest.mjs run tests/host/process.spec.ts -t "continues standalone Sessions"` | 1 通过 / 0 失败；测试 1.02 秒（修复前本机约 18 秒） |
| `node node_modules/vitest/vitest.mjs run tests/integration/compaction/evidence.spec.ts` | 1 通过 / 0 失败；测试 864 ms |

## 坑与发现

- 通过/失败差异来自同一代码的相邻 run，只能说明运行不稳定，不能直接归因并行竞争；阶段计时才定位到 mock 脚本耗尽后的确定性退避。
- 两项测试原先都“通过”，但 Host 续接测试实际上在第二次 Host 的第二个 Turn 失败后仍然断言通过；仅看绿灯会漏掉真实失败。
- 单项预算调整只针对一个确有长流程的集成测试；默认 5 秒仍是其余测试的门槛。

## 下一步

修复随原功能分支独立提交并推送，PR #80 保持 Draft 等待人工审核。Step E 合并未授权，F13.1a 整体保持进行中。当前 head 的 CI 结果待本轮推送后核对。
