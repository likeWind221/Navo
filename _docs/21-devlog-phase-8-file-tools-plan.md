# 阶段 8 通用文件工具与网页结果留存规划

## 当前工具面

阶段 8 采用 Pi / DSH 风格的四个模型工具：

```text
read   已知文本读取
shell  路径发现、搜索与命令执行
edit   已有文本的局部精确替换
write  新建或整文件替换
```

模型层不提供独立 `find`。文件发现交给 `shell`；`read` 只读取已知路径；`edit` 负责 targeted change；`write` 只接收 `path + content`，不让模型选择 create/overwrite。

## 文件环境

代码使用 `FileEnvironment` 表示一次文件工具调用所在的执行环境，目前只固化 `cwd`。宿主通过 `resolveFileEnvironment(sessionId)` 为工具提供该环境；相对路径基于 `cwd`，绝对路径保留当前执行环境语义。Session ID 不自动形成物理目录，也不把“有 cwd”误当成沙箱。

8.3 起文件能力由宿主显式启用：`ToolsPluginConfig.file` 缺失时不注册 `read/shell/edit/write`，不会默认暴露 `process.cwd()`；Kernel Host 只有设置 `SKILLWORLD_FILE_CWD` 时才创建文件环境。当前 Host 内 Session 共享这一 cwd，未来宿主可以只替换 resolver 来实现不同 Session 到不同工作区的映射。

## 8.4：观察与版本安全

8.4 将 8.2.5 的“完整观察”升级为“完整观察某一个文件版本”。本地 `FileVersion` 是 opaque freshness token：

```text
FileVersion = dev + ino + size + mtimeNs
```

`dev + ino` 描述本地文件对象身份，`size + mtimeNs` 提供低成本 freshness 信号。该 token 用于 optimistic concurrency，不是密码学内容摘要；当前阶段不使用 SHA，也不承诺跨进程原子 CAS。

`read` 在打开文件后取得初始版本，完成文本扫描后再次检查打开句柄和 canonical target；读取期间若文件发生变化则返回 `stale-version`，不会建立 observation。分页读取只累计同一版本的 coverage：若后续分页来自新版本，旧 coverage 会被丢弃，不能把 V1 的前半页和 V2 的后半页拼成完整观察。

```text
Read V1
  ↓
coverage(V1)
  ↓
只有 1..EOF 全部来自 V1
  ↓
Observation(path, V1)
```

## Edit / Write 的 optimistic guard

已有文件的模型侧修改必须基于同一 Session 的完整 observation。`edit` 与已有目标的 `write` 在 canonical target 上进入目标级串行区，并比较：

```text
observedVersion == currentVersion ?
  ├─ no  → stale-version，丢弃旧 observation，要求重新 read
  └─ yes → 构造 staging → 提交前再检查版本 → atomic publish
```

因此两个 Session 即使都观察了 V1，也不能同时静默提交：同目标结构化修改在当前进程内串行，第一个提交后目标成为 V2，第二个进入临界区时会因 stale-version 失败。

`edit` 的 `oldText` 唯一匹配仍保留，但它只负责“改哪里”；版本 guard 负责“是不是还在修改自己读过的那个版本”。

## 新文件的并发创建

目标不存在时不能使用“先 exists 再 rename”的检查，因为检查与提交之间存在 create race。8.4 为 create 路径增加 `create-if-absent` 发布：完整内容先写 sibling staging，随后通过同文件系统 hard-link 提交；若目标已经出现，提交以 `EEXIST` 失败，不覆盖并发创建者。

```text
staging complete
  ↓
link(temp, target)
  ├─ success → target 原子出现
  └─ EEXIST  → reject，不覆盖
```

替换已有文件仍使用 sibling staging + fsync + close + rename；提交前版本 guard 只覆盖当前进程协调与常规外部 stale detection，不宣称提供跨进程 compare-and-swap。

## Shell 边界

Shell 在 8.4 中保持独立执行能力，不加入 FileObservationStore，也不参与 FileMutationCoordinator：

```text
Structured File Tools             Shell
read/edit/write                    command execution
     │                                  │
observation/version                     │
atomic mutation                         │
     └──────── filesystem ──────────────┘
```

`cat`、`head`、Python `open()` 等 Shell 内读取不会建立受信任 observation；Shell 执行本身也不会因为“可能修改文件”而全局清空 observation。若 Shell、IDE 或其他外部 actor 实际修改了目标，后续结构化 Edit/Write 会通过版本比较得到 `stale-version`。

Shell 能访问哪些文件、是否只读、是否需要 approval/escalation 属于后续 Sandbox 能力，不在 Phase 8 伪装为已实现。

## Fetch spill

8.3 已将 Fetch 的完整正文与模型内联预算分离：超出模型预算且启用了文件环境时，完整格式化正文原子写到 `web/fetch-*.md`，模型只收到有界 preview、`file_path` 和继续 `read` 的提示。

8.4 后 Fetch spill 的新文件发布也使用 `create-if-absent`；它不调用模型层 `write`，也不自动建立 observation。Agent 若要修改 spill 文件，仍需先通过 `read` 完整观察。

## 阶段顺序与状态

```text
8.1  文件协议与错误                         ✅
8.2  read / shell / edit / write            ✅
8.3  Tools 根、Node 白名单、Fetch spill      ✅
8.4  文件版本与并发安全                      ✅
8.5  本地 Node 24 + pnpm 最终工程验收        待执行
```

8.5 不新增功能，只在干净本地环境执行 `pnpm install --frozen-lockfile`、typecheck、全量测试、build，并验证 Search→Fetch→spill→Read、Read→Edit/Write、stale-version、并发写、并发创建与取消场景。8.5 完成前不宣称 Phase 8 已通过完整工程回归。

详见 [8.4 文件版本与并发安全开发记录](59-devlog-step-8-4-file-version-concurrency.md)。
