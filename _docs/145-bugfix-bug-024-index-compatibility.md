# BUG-024：索引版本兼容性判断

日期：2026-10-23
基线：当前 master `1b61b68`；分支：`fix/bug-024-index-compatibility`。

## 现象与复现

旧 Chunker 或向量编码版本的活动索引可能阻止重建；旧 Chunker 的 building 可能恢复发布。使用磁盘 SQLite 预置旧版本索引后重启复现。

## 已证实事实与根因假设

`needsBuild()` 手写条件遗漏 `chunker_version`、`vector_encoding_version`；`recoverable()` 仅调用 `compatibleProvider()`，遗漏 Chunker，并仅过滤不兼容记录，未将其废弃。根因已由源码确认。

## 修复内容

- `needsBuild()` 调用现有 `compatible()`，统一检查正文代次、Chunker、Embedding provider/model/revision/dimension、文档与查询模板和向量编码版本。
- `recoverable()` 在原事务内读取当前正文并调用同一函数；正文不存在或不兼容的 building 直接 superseded，不进入恢复发布，后续调度按当前版本构建。
- 参数化回归覆盖两种旧版本各自的 active / building 状态；断言实际重新 Embedding 当前正文、旧 build 被废弃、新 build 使用当前版本，并检查 building 在新 Embedding 前已经废弃。
- 不修改数据库结构，不新增表或字段，不扩展其他 F13 功能。

## 验证结果与边界

Windows PowerShell，Node `v24.19.0`：

- `pnpm exec vitest run tests/resource/index tests/storage/indexing.spec.ts`：3 文件、14 项通过，包含新增 4 项版本回归和既有兼容 building 恢复。
- `pnpm typecheck`：通过。
- `git diff --check`：通过。

使用 mock Embedding，不调用真实模型 API。2026-10-23 首轮仅进行本地相关检查；2026-10-24 用户授权并入 F13.3c 的 [PR #92](https://github.com/likeWind221/Navo/pull/92)，本次组合验证见下。

## 后续

修复已通过独立提交并入 `phase13-f13.3c-graph`，随 PR #92 推送；2026-10-24 用户明确授权合并，PR #92 已合入 master（de2bb17）。

## 2026-10-24 组合验证

- `pnpm exec vitest run tests/resource/index tests/resource/graph tests/storage/indexing.spec.ts --maxWorkers=4`：7 文件、39 项通过。
- `pnpm typecheck`：通过。
- `pnpm test --maxWorkers=4`：150 文件、963 项全部通过，用时 352.98 秒。
- `git diff --check`：通过。PR #92 head `bc5bd11` 的 CI run `40060389161` 成功；已按用户授权 squash 合入 master（`de2bb17`），BUG-024 关闭。
