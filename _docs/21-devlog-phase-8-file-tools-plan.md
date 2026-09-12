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

8.3 起文件能力改为宿主显式启用：`ToolsPluginConfig.file` 缺失时不注册 `read/shell/edit/write`，不会把 `process.cwd()` 默认暴露给 Agent；真实 Kernel Host 只有设置 `SKILLWORLD_FILE_CWD` 时才创建并固定文件环境。当前 Host 配置让其内部 Session 共享这一 cwd，未来若宿主需要不同 Session 映射到不同目录，只需替换 resolver，不改变工具 API。

## Write 的安全边界

8.2.5 对齐 DSH 的职责划分，但只实现本阶段需要的两层安全：

```text
观察安全：existing file 必须先由同一 Session 完整 read；分页读取需累计覆盖全部行
原子安全：完整内容先写 sibling staging，fsync + close 后 rename 提交
```

目标不存在时 `write` 可直接创建；目标已存在时只有当前 Session 已完整观察该 canonical path 才允许覆盖。`read` 的分页结果会累计行区间，只有从第 1 行到 EOF 均被成功读取后才转为“完整观察”；只读任意一页仍返回 `not-observed`。成功的 `write` 已知完整结果，因此直接标记为完整观察，新建文件可在同一 Session 内继续整文件写入。

当前观察记录只表示“该 Session 已完整读过这个 canonical path”，不保存 mtime/hash/version。因此它不解决 `read(V1) -> 外部修改(V2) -> write` 的 stale overwrite；这类并发/版本安全统一进入 8.4。

## 原子修改

`edit`、`write` 与 Fetch spill 共用 `atomic.ts`：

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

提交前失败或取消会清理 staging，原目标保持不变；rename 成功后不再把迟到取消伪报成失败。overwrite 保留已有文件 mode，新建文件与 Fetch spill 使用普通文本文件权限。

## Fetch spill

8.3 将 Fetch 的“完整正文”和“模型内联预算”分开：网络层仍必须先得到完整、受硬上限约束的正文；若格式化结果能放进模型预算，则继续直接返回。若超出模型预算且当前 Host 启用了文件环境，则将完整格式化正文原子写到 `web/fetch-*.md`，模型只收到有界 preview、`file_path` 和继续 `read` 的提示。

Fetch spill 不调用模型层 `write`，也不会把新文件直接记为 observed；preview 不等于完整读取，Agent 若后续要整文件覆盖该 spill，仍必须先通过 `read` 完整观察。

## 阶段顺序

按“先完成源码，再统一验收”的开发方式，阶段 8 顺序正式调整为：

```text
8.3  Tools 根、Node 白名单与 Fetch spill 接入
  ↓
8.4  文件并发与版本安全收口
  ↓
8.5  Work 模式最终工程验收
```

- **8.3**：组装四个文件工具、共享 ObservationStore、显式 Host FileEnvironment、Fetch spill、NodeAgent 仅获得 `read`。
- **8.4**：统一审查并补齐 Read/Edit/Write/Shell 的并发与版本安全，包括可比较文件版本、stale-version、create-if-absent 提交保护、必要的目标级串行化，以及 Shell/外部修改导致旧观察失效的行为。
- **8.5**：在 Work 模式/干净 Node 24 + pnpm 环境执行安装、typecheck、全量测试、build、Search→Fetch→spill→Read、文件修改及并发安全场景的最终工程验收。

8.4 完成前不宣称已解决 lost update 或跨进程竞态；8.5 完成前不宣称 Phase 8 已通过完整工程回归。
