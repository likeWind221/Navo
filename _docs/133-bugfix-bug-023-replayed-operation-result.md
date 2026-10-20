# BUG-023：已完成操作的重试返回后续 Resource 状态

日期：2026-10-20；分支：`fix/bug-023-replayed-operation-result`；基线：`35fd7ab`。

## 现象与复现

同一个 `operationId` 重试已成功的创建/替换操作时，`ResourceLifecycle.write()` 只按 `resource_id` 读取当前投影并直接返回。只要该 Resource 在首次提交后继续变化，调用方就会拿到后续状态：

- 创建后替换，再重试创建：返回代次 2 与 revision 2 的 Resource，冒充原创建结果。
- 创建后修改元数据，再重试创建：返回 revision 2，冒充原创建结果。
- 创建后删除，再重试创建：删除投影仍保留 Resource 主体，重试返回已删除对象，语义上等于复活。
- 删除操作重试虽返回成功，但未显式核对原删除事件；`business_result` 只是操作记录字段，不是提交事实的独立证明。

修复前回归测试中，前三项分别得到上述错误结果；第 5 项（删除重试）已具备幂等行为，但没有提交事件核对。

## 已证实事实与根因假设

- 已证实：`src/resource/lifecycle.ts` 的已完成操作分支只调用 `store.getState(resource_id)`；没有核对操作记录对应的提交事件、提交 revision 与目标代次。
- 已证实：`projector` 在删除后保留 `status: "deleted"` 的 Resource 主体，因此“state 存在”不等于“Resource 仍有效”。
- 已证实：操作记录的 `business_result` 与 Resource 事件在同一 SQLite 事务中提交，但快速返回路径未使用事件校验，无法发现 Resource 后续变化。
- 根因已确认，不是并发时序问题：同一 `operationId` 的并发请求由内存 `running` 表合并；问题出现在跨请求的已完成重试路径。

## 修复内容

| 文件 | 改动 |
|---|---|
| `src/resource/commit.ts` | 新增操作与提交事件的共享核对：按 `operationId` 查找事件，校验事件类型、`resourceId`、`baseRevision` 与 `revision = baseRevision + 1`，并核对目标代次与准备文件位置。 |
| `src/resource/lifecycle.ts` | 已完成创建/替换重试先核对提交事件，再要求 Resource 仍为 active 且 `revision`、`assetGeneration` 与提交事件一致；否则返回 `operation-result-stale`，已删除则返回 `resource-unavailable`。已完成删除重试同样核对原删除事件后才返回成功并重试清理。 |
| `src/resource/errors.ts` | 新增 `operation-result-stale`。 |
| `src/resource/recovery.ts` | 清理恢复复用同一核对，删除重复的事件一致性判断。 |
| `tests/resource/assets/retry.spec.ts` | 新增五组回归：立即重试、替换后重试、删除后重试、改元数据后重试、删除重试。 |

不新增数据库表、不保存不可变响应快照，也不改变 `business_result`；原操作仍保持 `succeeded`。删除接口仍返回 `void`，重试不重复写事件或删除文件。

## 验证结果与边界

环境：Windows 11；可用 Node **22.23.1**（项目声明 ≥24，本机未安装 Node 24，未使用项目验收基线）；命令前将 `C:\Windows\System32` 置于 PATH 最前。

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | 通过，exit 0 |
| `node node_modules/vitest/vitest.mjs run tests/resource/assets/retry.spec.ts tests/resource/assets/flow.spec.ts tests/resource/assets/recovery.spec.ts tests/resource/lifecycle.spec.ts` | 4 文件、28 项通过 |
| `pnpm test --maxWorkers=4` | 135 文件、856 项通过（基线 851 项 + 新增 5 项） |

回归同时断言返回值、Resource 事件数量、操作终态与磁盘文件存在性。未覆盖：PR head 的 CI 尚未运行；未验证 Node 24 环境；不包含完整不可变操作结果快照模型。

## 后续

推送分支并创建 PR，等待人工审核与当前 head CI；通过后再按仓库规则合并。若未来确实需要返回原操作的完整响应快照，应单独设计操作结果模型，不在本次范围内。
