# 阶段 8：通用文件工具与网页结果留存（合并记录）

> 本文整合阶段 8 的规划、调研、Step 8.1–8.5 开发记录与最终验收，以阶段结束时的代码行为为准。早期记录中曾设计独立 `find`、严格 Session 相对路径和模型选择 create/overwrite，这些方案均已被后续实现替代。

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
8.5  本地 Node 24 + pnpm 最终工程验收        ✅
```

8.5 已在干净本地环境完成 `pnpm install --frozen-lockfile`、typecheck、全量测试与 build，并验证 Search→Fetch→spill→Read、Read→Edit/Write、stale-version、并发写、并发创建与取消场景。首轮全量测试暴露文件工具注册缺少 `tools` 注入声明，修复后 47 个测试文件共 324 项全部通过。

## 分步交付记录

### 8.1 文件协议与路径语义

8.1 最初定义 `read/find/write/edit` 的 Schema、请求、结果、协议预算和稳定 `FileError`，随后依据 Pi Coding Agent 调研收口为 `read/write/edit`，文件发现交给 `shell`。模型不能传入 `sessionId` 或工作区根；工具 Schema 只承担结构校验，路径定位、大小、文本和条件字段由执行边界校验。

路径契约从“只允许 Session 相对路径”修订为执行环境语义：相对路径基于 Session 固化的 `cwd`，绝对路径保留原语义；Session ID 不形成物理目录。现存目标通过真实路径形成 canonical identity，缺失叶子基于已存在的真实父目录定位；符号链接归一到真实目标。路径解析不是沙箱授权。

`FileError` 将内部 `message/cause` 与固定模型文案分离，不向模型回显绝对路径或底层异常。协议测试验证模型不能伪造 Session 或工作区信息，废弃的 `find` Schema 和提示也已移除。

### 调研结论：Pi 与 DeepSeek Harness

Pi 默认提供 `read/bash/edit/write`，`grep/find/ls` 是可选只读工具；未启用这些可选工具时，Agent 通过 Shell 发现路径，再用 `read` 读取已知文件。阶段 8 因此采用四工具面，不建立独立 `find`。

Read 采用 DeepSeek Harness（DSH）的普通文件预检、大小分流、结构化窗口和独立模型投影，但直接使用 Node 文件句柄，不引入 `ctx.fs`、Provider 或远程文件系统。Shell 采用 DSH 的有界尾部输出、PowerShell 解析、超时/取消分类和进程树终止算法，但不引入 `ctx.shell`、后台作业、Sandbox、approval 或原生 FFI。

文件版本参考 DSH 的高精度 stat token；本项目使用 `dev:ino:size:mtimeNs`，未纳入 `ctimeNs`，也不使用内容 hash。最终装配遵循 Cordis `ctx.inject` 的服务依赖生命周期；由于 `ToolsPlugin` 自己创建 `ToolService`，文件工具只在内部注册边界条件注入 `tools`，而不是让根插件静态依赖自己创建的服务。

### 8.2.1 工作区定位与文件目标

宿主通过 `resolveFileEnvironment(sessionId)` 提供固化、规范化且存在的绝对 `cwd`。相对路径以该目录为基准，绝对路径按执行环境定位；共享同一 `cwd` 的 Session 对同一物理文件得到同一 canonical target，不同 `cwd` 的相对路径互不混淆。

现存符号链接沿真实目标归一化；缺失目标只允许在已存在父目录下形成待创建目标。此层只负责目标身份，不承担文件内容 IO 或权限沙箱。

### 8.2.2 纯文本 Read Tool

`read` 完成普通文件预检、严格 UTF-8 解码、BOM/CRLF 处理、行窗口、结构化结果和模型文本投影。小文件按已知大小读取，大文件按 64 KiB 分块，两条路线共享窗口与预算语义；默认 200 行、最多 1000 行，模型正文连同路径、行号和 continuation 不超过 30,000 个 UTF-16 代码单元。

读取扫描到 EOF 以得到准确总行数并验证全文，只保留目标窗口和有界片段。第一条目标行无法放入预算时返回明确错误，后续行放不下时给出下一次读取位置。严格拒绝非法 UTF-8、NUL 和残缺尾序列；取消贯穿路径解析、文件操作和关闭句柄。

分页结果按同一文件版本累计 coverage，只有从第 1 行到 EOF 全部来自同一版本才建立完整 observation；读取期间目标变化返回 `stale-version`，不建立观察。

### 8.2.3 Shell Tool

`shell` 在 Session `cwd` 中执行命令，参数为必填 `command` 和可选 `timeoutMs`（1–600000，默认 120000）。stdout/stderr 各自保留最后 64,000 字节，结果区分退出码、信号、超时和取消；超时是带标记的命令结果，用户取消收敛为 `cancelled` 工具失败。

Windows 优先 PowerShell 7，再回退 Windows PowerShell；其他平台使用 bash。Windows 通过 `taskkill /T /F` 结束进程树，POSIX 使用独立进程组 `SIGTERM` 后升级 `SIGKILL`。子进程环境剔除名称匹配密钥、密码、Secret 或 Token 的变量。

PowerShell 命令末尾追加换行和 `exit $LASTEXITCODE`，保留原生命令退出码。Windows 不从 PATH 猜测 bash，避免误入 WSL 文件系统命名空间。Shell 不产生可信文件 observation，也不加入结构化文件修改协调器。

### 8.2.4 Edit Tool

`edit` 读取现有普通文本文件，对非空 `oldText` 执行唯一字面替换；不存在、多次或重叠命中均拒绝修改，不做 Unicode 或换行归一化，空 `newText` 表示删除。源文件、请求文本和结果均受严格 UTF-8、NUL、孤立代理项与 5 MiB 边界约束。

修改写入同目录 staging，按 64 KiB 分块检查取消，随后保留权限、`fsync`、关闭句柄并原子发布。最终提交前失败或取消会清理 staging；提交成功后不把迟到取消伪报为失败。

### 8.2.5 Write Tool

`write` 只接收 `path + content`：目标不存在时创建，目标存在时整文件替换，模型不选择 create/overwrite。已有文件必须先由同一 Session 完整 `read`，否则返回 `not-observed`；新建或成功写入后刷新当前 Session 的完整 observation，不同 Session 不共享观察。

Edit 与 Write 共用 sibling staging、分块写入、取消、权限、`fsync`、关闭、原子发布和失败清理。新建目标通过 `create-if-absent` 发布，若并发创建者已经提交则返回冲突，不静默覆盖。

### 8.2.6 工具结果出口

`ToolOutput` 收口为单臂 `{ content: string, artifact?: JsonValue }`。`ToolService` 只校验字符串 `content` 并投影为文本块，成功结果可携带可选 artifact；现有工具统一返回 `{ content }`，不再维护字符串、文本块数组和对象三种等价出口。

`artifact` 在本阶段只定义协议，尚未接入 Session 事件、RPC 或前端消费。脚本不在根 `tsconfig.include` 中，因此相关工具返回形态通过静态扫描同步修正。

### 8.3 Tools 根、Node 白名单与 Fetch spill

文件能力改为宿主显式配置。`ToolsPluginConfig.file` 存在时，四个文件工具共享 FileEnvironment 和 FileObservationStore；缺失时不注册工具，也不默认开放 `process.cwd()`。Kernel Host 只有设置 `SKILLWORLD_FILE_CWD` 才启用该能力。

NodeAgent 根据实际注册状态只增加 `read`，不获得 `shell/edit/write`；教材和题集仍只能由领域工具修改。Fetch 完整正文超过内联预算时，内部原子写入 `web/fetch-*.md`，模型只收到有界 preview、`file_path` 和继续读取提示。spill 创建不自动建立 observation，留存失败与网络失败使用不同错误。

### 8.4 文件版本与并发安全

`FileVersion` 使用 `dev:ino:size:mtimeNs` 作为 opaque freshness token。Read 在打开后和扫描结束后比较句柄与 canonical target；Edit/Write 在目标级串行区比较 observation 与当前版本，写完 staging 后、发布前再次检查。版本不一致时丢弃旧观察并返回 `stale-version`。

同进程内两个 Session 即使都观察了 V1，也只有第一个结构化修改能提交；第二个进入临界区后看到 V2 并失败。并发新建通过 sibling staging 加 hard-link 的 create-if-absent 发布保证只有一个成功。Fetch spill 复用该发布方式。

Shell、IDE 或外部进程若修改目标，下一次结构化写通过版本比较检测 stale；Shell 本身不全局清空 observation。`assertFileVersion()` 与最终 rename 之间仍存在外部进程 TOCTOU，本阶段不承诺跨进程 CAS、分布式锁或远程文件系统版本协议。

### 8.5 最终工程验收与装配修复

验收环境为 Node v24.14.0、pnpm 10.33.0。依赖安装使用 frozen lockfile；阶段 8 专项 13 个测试文件共 89 项通过，覆盖 Search→Fetch→spill→Read、Read→Edit/Write、stale-version、并发写、并发创建与取消。

首轮全量测试发现文件工具注册在未声明依赖的 effect 中读取 `ctx.tools`，Cordis 以 `cannot get property "tools" without inject` 拒绝装配。修复后文件工具通过 `ctx.inject(["tools"], ...)` 等待服务，并让注册、逆序回滚、卸载注销和 observation 清理保持同一生命周期。未修改文件算法、协议或测试断言。

最终 `pnpm typecheck`、47 个测试文件共 324 项测试和 `pnpm build` 全部通过。

## 最终边界与下一步

阶段 8 已正式结束。当前保证同进程结构化文件修改的完整观察、常规 stale detection、目标级串行化、原子替换与并发创建保护；明确不提供文件系统沙箱、Shell approval、跨进程 compare-and-swap、跨主机一致性、远程文件系统协议或图片/二进制 Read。

这些边界不是阶段 8 遗留项；若产品需要，应在新的后端阶段中单独规划。
