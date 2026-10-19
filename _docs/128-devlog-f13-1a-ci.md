# F13.1a：CI 并发稳定化

日期：2026-10-19；分支：`feature/f13-1a-step-c`；原代码提交：`a264abac`；PR #80 保持 Draft，不合并。

## 做了什么

核对 [原 GitHub Actions 日志](https://github.com/likeWind221/Navo/actions/runs/39258017004)。typecheck 通过；测试 840 通过、3 失败，三项均为 `Test timed out in 5000ms`，没有实际断言失败：

- `tests/session/persistence.spec.ts`：rejects Project identities presented as standalone or mixed ownership: second。
- `tests/workspace/store.spec.ts`：restores bindings and root ownership after a storage restart。
- `tests/integration/compaction/evidence.spec.ts`：publishes source-linked excerpts privately, preserves exact RECORD lines and survives restart。

只将 `.github/workflows/ci.yml` 的测试命令改为 `pnpm test --maxWorkers=4`；不调整全局超时、不跳过测试、不修改业务代码。新增本记录并登记索引。

## 关键决策

CI 中上述测试耗时约 10 秒或触发 5 秒上限，其他多个文件系统/SQLite 测试也明显变慢；既有本地默认并行曾发生另一项网络测试超时，而限并发完整运行通过。本次默认命令在本地未重现原三项失败，不能称其每次必现。限制 worker 控制资源竞争，保留全部测试与失败机制；最终以当前 commit 的远端 CI 判断此调整是否有效。

## 验证

Windows / bundled Node 24.19.0；System32 与 bundled Node bin 前置 PATH。

| 命令 | 通过 / 失败 | 结果 |
|---|---|---|
| `pnpm test` | 843 / 0，134 文件 | 默认并行本地复现尝试，64.03 秒，未重现 CI 超时 |
| `pnpm typecheck` | exit 0 | 通过 |
| `pnpm test --maxWorkers=4` | 843 / 0，134 文件 | 对照验证，56.09 秒 |

## 坑与发现

超时不是断言失败；单次本地通过也不足以证明 CI 稳定。此调整不归因于已确认的业务代码错误，也不扩大到依赖配置或测试超时。

## 下一步

CI 稳定化独立提交并推送；确认该 head 的 GitHub CI 通过后再实施 Step D。Step D 使用真实进程强杀与自然失效锁恢复，不以普通异常、模拟数据库状态或改锁时间代替。F13.1a 保持进行中。
