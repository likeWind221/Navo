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
Observation safety: 未 read 的 existing file 不能被 Write 盲覆盖
Atomic safety:       提交前失败/取消不留下半文件
```

本步骤不保存文件版本，也不在提交时比较 mtime/hash，因此不解决 `read -> 外部修改 -> write` 的 stale overwrite；并发创建、lost update、目标级锁等统一进入 8.5 文件并发与版本安全收口。

## 验收

独立运行时 smoke 已覆盖：创建、创建后的再次写入、盲覆盖拒绝、分页只读前段仍拒绝覆盖、读完全部分页后允许覆盖、Session 隔离、权限保留、symlink canonical path、预取消无 staging 残留，以及 Edit 抽取 `atomic.ts` 后的回归。当前执行环境为 Node 22，项目要求 Node >=24 且未安装锁定依赖，因此未声称运行完整 Vitest/typecheck；本次涉及模块已通过针对性的严格 TypeScript 类型检查和运行时 smoke。

## 下一步

进入 8.3，将 `read / shell / edit / write` 与共享 FileEnvironment、ObservationStore 正式组装到 Tools 根，并接入 Node 白名单与 Fetch spill；8.5 再统一加入版本观察与并发保护。
