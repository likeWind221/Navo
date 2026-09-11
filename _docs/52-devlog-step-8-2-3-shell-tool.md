# 8.2.3 Shell Tool

## 做了什么

- 新增 `shell` 工具：`src/tools/builtins/shell/types.ts`、`errors.ts`、`profile.ts`、`execution.ts`、`tool.ts`（`profile.ts` 负责方言解析与调用参数，`execution.ts` 负责 spawn、收集与终止）。
- 让 Agent 在 Session 固化的执行世界 `cwd` 中执行命令，并用 `rg`、`ls`、`find` 或 PowerShell 命令发现和搜索文件；不再需要独立 `find` 工具。
- 工具参数为 `command`（必填）与可选的 `timeoutMs`（1..600000，默认 120000）；结果包含 `exitCode`、`signal`、`timedOut`、`aborted`、`timeoutMs`，以及 stdout/stderr 各自的 `text` 与 `truncated`。
- stdout/stderr 各自保留**最后 64000 字节**并标注截断；模型投影为 stdout、`[stderr]` 段、截断提示与标记行（`[timed out after Nms]`、`[killed by signal: X]`、`[exit code: N]`），无输出时为 `(no output)`。
- 方言解析：`powershell` 与 `bash` 两类。win32 默认 powershell（`Program Files\PowerShell\7\pwsh.exe` → PATH 中的 `pwsh.exe` → Windows PowerShell 5.1 → 裸 `pwsh`），其他平台默认 bash（`/bin/bash` → PATH `bash`）。工具描述由解析结果生成，写明方言、路径形态、环境变量语法与解析到的 shell 名称。
- 执行机制：`node:child_process.spawn`，stdin 关闭、stdout/stderr 管道；超时与取消用 `AbortSignal.any` 融合后按首因分类；终止在 Windows 用 `taskkill /PID <pid> /T /F`，POSIX 用独立进程组 `SIGTERM` → 3s → `SIGKILL`；子进程环境剔除 `KEY|PASSWORD|SECRET|TOKEN` 形状的变量。
- 新增 `tests/tools/shell/execution.spec.ts` 与 `tests/tools/shell/tool.spec.ts`，共 15 项测试。

## 关键决策

- **算法照搬 DSH、边界重写**：不引入 `ctx.shell`/`ctx.subprocess` 双层 Cordis Service、settings 分区、jobs、sandbox、approval、原生 FFI；只移植纯算法与语义。
- **`kind` 收缩为两个值**。`pwsh` 与 Windows PowerShell 5.1 的 argv 和编码前言完全相同（前言对 pwsh 幂等），差别只是解析顺序；Git Bash 与 bash 的 argv 相同（实测 `-c` 已能得到 `/mingw64/bin`、`/usr/bin`），差别只是可执行文件位置，用 `path` 表达。`auto` 也不需要：缺省即按平台取默认方言。
- **超时是命令结果，不是工具错误**：超时返回带 `[timed out after Nms]` 标记的正常结果；只有取消才走 `cancelled` 工具失败。
- **输出超限保留尾部**：尾部携带失败上下文；本步骤没有临时结果存储，因此不做 DSH 的 spill 文件。
- **win32 的 bash 不扫描 PATH**：PATH 上的 `bash.exe` 可能是 WSL，会产生完全不同的文件系统命名空间；只探测 Git 的标准安装位置。
- 本步骤只交付工具实现与测试，不接入 `ToolsPlugin`、`node/profile.ts`（8.3 负责），与 `read` 的交付方式一致。

## 采用的 DSH 机制与差异

- `deepseek-harness/packages/subprocess/subprocess-local/src/spawn.ts`：`OutputCollector.push` 按字节保留尾部、超限先丢整块头部再精确裁块。采用该算法；去掉 spill 文件、`readFrom` 增量坐标与 `lossy` 语义。
- `deepseek-harness/packages/shell/pwsh-local/src/resolve.ts`：候选路径顺序，以及用 `lstat`（而非 `stat`）识别 Microsoft Store 应用执行别名。采用；差异是只接受绝对 PATH 条目，且 win32 的 bash 只探测 Git 安装位置。
- `deepseek-harness/packages/shell/pwsh-local/src/index.ts`：`pwsh -NoLogo -NoProfile -NonInteractive -Command <命令>`、UTF-8 编码前言、`NO_COLOR/PAGER/GIT_PAGER`、POSIX 追加 `TERM=dumb`。采用。
- `deepseek-harness/packages/shell/tool-pwsh/src/render.ts`：`[stderr]` 段、标记顺序（退出码最后）、`(no output)`。采用；差异是截断提示合并为一条且不输出 spill 路径。
- `deepseek-harness/packages/util/timeout/src/index.ts`：`deadline()` 用 `AbortSignal.any` 实现首因分类。采用其分类思想，但直接用 Node 原生 `AbortSignal.any` 与超时 `AbortController`，不引入 `TimeoutReason`。
- `deepseek-harness/packages/shell/tool-pwsh/src/index.ts`：`run_in_background`、`sandbox_permissions`/`justification` 升级、`workdir` 覆盖、`description` 参数均未采用——本阶段没有后台作业、沙箱策略与卡片元数据消费者。

## 坑与发现

- **`pwsh -Command` 折算退出码**：实测 `node -e "process.exit(3)"` 经 `pwsh -Command` 后进程退出码是 1，`process.exit(0)` 是 0，`rg` 未命中也是 1——非零原生命令退出码被折算成 1。追加换行后的 `exit $LASTEXITCODE` 可恢复真实退出码（实测 3、7、0，cmdlet 场景为 0）。这是对 DSH argv 的一处修正。用换行而非 `;` 拼接，避免命令以注释结尾时吞掉后缀。
- **PATH 相对条目短路**：vitest 进程的 PATH 含相对条目 `node_modules\.bin`，最初"非绝对路径即 PATH 兜底"的写法把它当成兜底项，解析出 `node_modules\.bin\pwsh.exe` 并在 spawn 时 ENOENT。改为只接受绝对 PATH 条目。
- **Windows 临时目录 EBUSY**：被 spawn 当作 `cwd` 的合法临时目录在子进程句柄释放前无法立即删除，测试改为直接用系统临时目录作为执行世界。
- **Git Bash 的 PATH**：实测 `bash.exe -c` 已由 MSYS 运行时把 `/mingw64/bin:/usr/bin` 置于 PATH 前部，`ls`、`rg`、`node` 均可解析，无需 `-lc`（`-l` 只额外加载 `/etc/profile`，会更慢并可能产生额外输出）。本机 PATH 上的 `bash` 指向 `C:\WINDOWS\system32\bash.exe`（WSL），据此决定 win32 的 bash 不扫 PATH。
- **pwsh 启动成本**：每次约 1.5s，单个测试内串行多次 spawn 会超过 vitest 默认 5s 超时；测试按"一次 spawn 一个断言组"拆分。

## 验证

- `pnpm typecheck` 通过。
- `pnpm vitest run tests/tools/shell`：2 文件 15 项通过，覆盖候选顺序与方言参数、执行世界 `cwd`、UTF-8、stderr 分离、非零退出、尾部截断、超时、取消、spawn 失败与已触发取消、Schema 注册、参数校验与模型投影。
- `pnpm test`：40 个文件 292 项通过。
- 未验证：bash 方言的真实执行（本机只有 win32，仅覆盖候选列表与 argv 生成）；跨执行世界授权与沙箱仍明确未实现。

## 下一步

进入 8.2.4 Edit Tool；8.3 负责把 `read`、`shell`、`edit`、`write` 接入 `ToolsPlugin` 与 Node 白名单。
