# 阶段 8 通用文件工具与网页结果留存规划

## 当前工具面

阶段 8 采用 Pi / DSH 风格的四个模型工具：

```text
read   已知文本读取
shell  路径发现、搜索与命令执行
edit   已有文本的局部精确替换
write  新建或整文件替换
```

模型层不再提供独立 `find`。文件发现交给 `shell`；`read` 只读取已知路径；`edit` 负责 targeted change；`write` 只接收 `path + content`，不让模型选择 create/overwrite。

## 文件环境

代码使用 `FileEnvironment` 表示一次文件工具调用所在的执行环境，目前只固化 `cwd`。宿主通过 `resolveFileEnvironment(sessionId)` 为工具提供该环境；相对路径基于 `cwd`，绝对路径保留当前执行环境语义。Session ID 不自动形成物理目录，也不把“有 cwd”误当成沙箱。

## Write 的安全边界

8.2.5 对齐 DSH 的职责划分，但只实现本阶段需要的两层安全：

```text
观察安全：existing file 必须先由同一 Session 完整 read；分页读取需累计覆盖全部行
原子安全：完整内容先写 sibling staging，fsync + close 后 rename 提交
```

目标不存在时 `write` 可直接创建；目标已存在时只有当前 Session 已完整观察该 canonical path 才允许覆盖。`read` 的分页结果会累计行区间，只有从第 1 行到 EOF 均被成功读取后才转为“完整观察”；只读任意一页仍返回 `not-observed`。成功的 `write` 已知完整结果，因此直接标记为完整观察，新建文件可在同一 Session 内继续整文件写入。

当前观察记录只表示“该 Session 已完整读过这个 canonical path”，不保存 mtime/hash/version。因此它不解决 `read(V1) -> 外部修改(V2) -> write` 的 stale overwrite；这类并发/版本安全统一留到 8.5。

## 原子修改

`edit` 与 `write` 共用 `atomic.ts`：

```text
complete bytes
    ↓
sibling temp (wx)
    ↓
64 KiB chunk write + AbortSignal
    ↓
chmod + fsync + close
    ↓
rename  ← commit point
```

提交前失败或取消会清理 staging，原目标保持不变；rename 成功后不再把迟到取消伪报成失败。overwrite 保留已有文件 mode，新建文件使用普通文本文件权限。

## 后续阶段

- 8.3：Tools 根、Node 白名单与 Fetch spill 接入。
- 8.4：文件工具与 Search→Fetch→Read 闭环集成验收。
- 8.5：统一审查并补齐 Read/Edit/Write/Shell 的并发与版本安全，包括可比较文件版本、stale-version、create-if-absent 提交保护、必要的目标级串行化，以及 Shell/外部修改导致旧观察失效的行为。

8.5 之前不宣称已解决 lost update 或跨进程竞态。
