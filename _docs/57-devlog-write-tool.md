# 8.2.5 Write Tool

## 做了什么

- Write Tool 改为 DSH 风格的 `path + content`：目标不存在时创建，目标已存在时整文件替换；模型不再传 `mode=create|overwrite`。
- 新增 Session 级 `FileObservationStore`。`read` 按 canonical path 累计已读取行区间，只有分页结果覆盖从第 1 行到 EOF 后才记为完整观察；已有文件只有在同一 Session 完整观察后才允许 `write` 覆盖，否则返回稳定 `not-observed`，原文件保持不变。
- `write` 成功后也记录目标，因此新建文件可在同一 Session 继续完整写入；不同 Session 的观察互不共享。
- 新增共享 `atomic.ts`，把 Edit 已验证的 sibling staging、64 KiB 分块写、AbortSignal、权限、fsync、close、rename 与失败清理抽成统一原子发布路径，Edit 行为保持不变。
- 将文件执行上下文命名从 `FileExecutionWorld / resolveWorld` 收敛为 `FileEnvironment / resolveFileEnvironment`；Shell 只同步命名，不改变执行行为。

## 安全边界

本步骤保证两层安全：

```text
Observation safety: 未完整 read 的 existing file 不能被 Write 盲覆盖
Atomic safety:       提交前失败/取消不留下半文件
```

本步骤不保存文件版本，也不在提交时比较 mtime/hash，因此不解决 `read -> 外部修改 -> write` 的 stale overwrite；并发创建、lost update、目标级锁等统一进入后续 **8.4 文件并发与版本安全收口**。

## 验收

2026-09-12 对 8.2.5 做了独立验收。当前执行环境只有 Node 22.16.0，项目要求 Node >=24，且容器无法访问 Node/npm 下载源，因此 Node 24、pnpm 10.33.0 与锁定依赖无法在本环境安装；未声称运行完整 `pnpm test` / `pnpm build`。

在该限制下完成了以下可执行验收：

- 使用 Node 24 的 `@types/node` 与项目 strict 编译选项，对本次涉及的 file/shell 源码做针对性 TypeScript 检查，通过。
- 对 `path/read/edit/write` 测试文件做针对性 TypeScript 调用边界检查，通过；Vitest 仅以临时声明补足测试 API，不替代真实 Vitest 运行。
- 将真实源码转译后执行 15 项文件系统行为检查，全部通过：FileEnvironment canonical cwd、创建、创建后再次写入、盲覆盖拒绝、完整 Read 后覆盖、Session 隔离、分页完整观察、乱序分页覆盖合并、空文件观察、权限保留、目录拒绝、非法文本/超限、symlink canonical target、预取消清理、中途分块写取消清理，以及共享 `atomic.ts` 后的 Edit 回归。
- 中途取消通过临时注入 FileHandle.write 行为，在首个 64 KiB chunk 写完后 abort，确认旧目标内容保持不变且 `.skillworld-write-*` staging 被清理。
- 源码与测试中无 `resolveWorld`、`FileExecutionWorld`、`createFileExecutionWorld` 残留；Write Schema 不再接受 `mode`。
- 本次涉及的生产源码文件均低于项目 300 行限制。

8.3 开发前复核发现远端 `read.ts/write.ts` 仍调用已经不存在的 `observations.observe(...)`；8.3 已将其分别纠正为 `observeRead(...)` 与 `observeWhole(...)`，该问题属于 8.2.5 的接口收口遗漏。

## 下一步

8.3 负责将 `read / shell / edit / write` 与共享 FileEnvironment、ObservationStore 正式组装到 Tools 根并接入 Fetch spill；随后进入 8.4 统一版本观察与并发保护，最后由 8.5 在 Work 模式执行完整工程验收。
