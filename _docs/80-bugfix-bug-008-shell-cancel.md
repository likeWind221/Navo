# 80：BUG-008 shell 取消后进程树漏杀

> 状态：**已修复**（2026-10-12，分支 `fix/bug-008-shell-cancel`）。2026-10-11 首次登记时仅排查；2026-10-12 采到失败现场、证实根因，用 Windows Job Object 修复。跟踪见 [Bug 跟踪表](bug-plan.md)。

## 现象与复现

- PR [#43](https://github.com/likeWind221/Navo/pull/43)（F10.1a）CI 的第 1、2 次运行中，`tests/tools/shell/execution.spec.ts` 的 “kills the process tree on cancellation and marks the result” 等满 vitest 默认 5 秒超时后失败；第 3 次运行通过。环境为 GitHub Actions `windows-2025-vs2026`，Node 24.21.0，shell 为 PowerShell。
- 该测试启动 `node -e "setTimeout(() => {}, 60000)"`，200ms 后取消；生产路径在 Windows 上同步执行 `taskkill /PID <shell> /T /F`，再等待子进程的 `close` 事件。
- 2026-10-11 在 CI 上做了 3 轮带诊断取证（PR #44、#45：取消时机扫描、完整套件重复运行，约 6 遍完整套件加 21 次专项取消），均未复现；诊断本身会改变时序。
- 2026-10-12 在本机复现：全量测试每轮先删 `node_modules/.vite` 冷启动，15 轮中 1 次挂起；热启动 15 轮 0 次。

## 已证实事实与根因

### 2026-10-11 已证实

1. 正常取消约 0.3 秒；taskkill 返回 0，耗时 96–220ms，列出 PowerShell 及其 `node`、`conhost` 子进程均已终止；`exit` 与 `close` 相差不到 10ms。失败时等满 5 秒仍没有 `close`，是**挂起**而非变慢。
2. 两个 shell 测试文件并发不是触发条件，不采用“改成先后跑”。
3. 旁证：CI 和本机满载时，其他依赖 5 秒默认超时的进程类测试也会偶发超时。

### 2026-10-12 采到的失败现场与根因（证实原假设 A）

- 挂起现场：taskkill 返回 0，shell 已 `exit`，但测试启动的 `node -e "setTimeout(() => {}, 60000)"` 仍存活，其父进程已死，并继承着 stdout/stderr 管道，因此 `close` 永不触发。
- **根因：** `taskkill /T` 先枚举进程树再逐个结束。若枚举时 pwsh 正在创建子进程，新进程不在列表中，成为孤儿存活。
- 漏杀率测量（启动后 200ms 结束）：本机 shell 解析为 Scoop 垫片 `C:\Users\likeW\scoop\shims\pwsh.exe` 时 9/10 漏杀；直接用真 pwsh 7/10；Windows PowerShell 5.1 为 0/10；启动 500ms 后再结束为 0/10。问题出在 pwsh 7 启动子进程的时机，与 Scoop 垫片无关。
- 两个生产后果，同一根因：
  1. 孤儿占着输出管道时，回合卡住到孤儿自行退出（BUG-008 的现象）；
  2. 不论是否占管道，被取消或超时的命令都会在后台继续运行。
- 排除：假设 B（taskkill 阻塞事件循环）与 C（管道关闭事件延迟）与现场不符：子进程实际存活。

## 修复内容

两层修复，前者兜底“卡住”，后者根除“继续运行”。

### 1. 排空等待（WIP 提交 `ea209ba`）

- `src/tools/builtins/shell/execution.ts`：子进程 `exit` 后最多等 `SHELL_LIMITS.drainMs`（1 秒）让管道关闭，超时则销毁 stdout/stderr 并返回结果。
- 对照 DeepSeek Harness `D:\Program\Miracle\kernel\packages\subprocess\subprocess-local\src\spawn.ts` 中 `exit` 后的 pipeDrainTimer；差异：Harness 复用 `graceMs`（3 秒），这里单列 1 秒的 `drainMs`，因为测试默认上限只有 5 秒，且排空只是兜底。
- 只解决“卡住”，不解决漏杀进程继续运行。

### 2. shell 自己进入 Job Object（本次）

- `src/tools/builtins/shell/job.ts` 生成 PowerShell 前置脚本，拼在每条命令之前（仅 Windows + PowerShell）：
  - 内嵌 C# 辅助类 `NavoShellJobV1`：`CreateJobObjectW` 建作业 → `SetInformationJobObject`（类别 9 `JobObjectExtendedLimitInformation`，`LimitFlags = 0x2000` 即 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，长度用 `Marshal.SizeOf`）→ `AssignProcessToJobObject(GetCurrentProcess())`。作业句柄存在静态字段里，只由 shell 进程持有（不可继承）。
  - 此后用户命令启动的所有子孙进程都自动在作业内。shell 一结束（被 taskkill，或正常退出），内核关闭最后一个作业句柄并结束作业内全部进程，不依赖枚举时机。
- **dll 缓存：** 首次编译后缓存为 `<jobDir>/navo-job-v1-<PSEdition>.dll`。`PSEdition` 为 `Core`（pwsh 7）或 `Desktop`（Windows PowerShell 5.1），两种 .NET 各一份，由脚本自行区分，Node 侧无需判断 shell 版本。
  - `jobDir`：Host 传入 `<NAVO_HOME>/cache/shell`（`NAVO_HOME` 默认 `~/.navo`），见 `src/host/config.ts` 的 `file.shellJobDir`；不经过 Host 创建工具时（测试、其他嵌入方）默认 `<os.tmpdir()>/navo/shell`。
  - 并发编译：先 `Add-Type -OutputAssembly` 写到 `*.<guid>.tmp`，再 `[IO.File]::Move` 改名（目标已存在会失败，同目录改名为原子操作）；失败说明别的命令已写好，删掉自己的临时文件，加载已有 dll。6 条命令并发冷启动实测：全部进入作业，目录只留一份 dll。
- **常驻路径只用 .NET 调用：** `[IO.File]::Exists` + `[Reflection.Assembly]::LoadFrom(...).GetType(...).GetMethod('Enter').Invoke(...)`。最初版用 `Test-Path` / `Join-Path` / `Add-Type -LiteralPath`，cmdlet 会触发模块自动加载，pwsh 7 上单条命令额外约 275ms，满载时被放大到约 1.5 秒；改为 .NET 调用后降到约 120ms。`Add-Type` 只在首次编译时使用。
- **失败退回：** 整段前置脚本包在 `& { try { ... } catch {} }` 中，作用域隔离、不输出、不改退出码。编译失败、目录不可写、环境禁止嵌套作业等情况下，命令照常执行，与修复前行为一致。taskkill `/T /F` 与排空等待不变，作为最后防线。
- 非 Windows、bash 路径不变（`ResolvedShellProfile.jobDir` 只在 win32 + powershell 时有值）。

### 与 Harness 的差异

Harness（`subprocess-local/src/spawn.ts` 的 `taskkillProcessTree`）在 Windows 上只用 `taskkill /PID <pid> /T /F`，没有 Job Object。本方案超出 Harness，理由：已证实 taskkill 枚举存在竞态，pwsh 7 在启动后 200ms 结束时 7–9 成漏杀；Job Object 由内核保证整树结束，是 Windows 上唯一不依赖枚举时机的手段。选择“shell 自己进入作业”而非由 Node 创建作业，是因为 Node 没有原生 Job Object API，引入原生插件代价更大。

### 需要知情的行为变化

命令结束时（正常退出、取消或超时），它在后台启动的进程也会一起被结束，例如 `Start-Process` 启动的服务、`detached` 子进程。需要长期运行的服务不能再通过一次 shell 调用留在后台。回归测试 “ends background processes together with the command” 固定了这一行为。

### 测试

`tests/tools/shell/execution.spec.ts`：

- “leaves no descendant alive after cancellation or timeout”：200ms 取消与 500ms 超时，各用唯一标记 `navo-bug008-<uuid>` 启动 node，结束后用 `Get-CimInstance Win32_Process` 查残留，断言为 0。变异校验：同一测试去掉作业后 3/3 失败。
- “ends background processes together with the command”：`Start-Process` 启动的 node 随命令结束。
- “runs the command without a job when the helper cannot be prepared”：`jobDir` 指向一个文件，编译失败走退回路径；命令输出正常、stderr 为空，且辅助类型未加载。
- 保留排空回归测试，并显式关闭作业（`jobDir: undefined`）。否则作业会在 shell 退出时结束孤儿，排空路径测不到。
- `shellInvocation` 断言前置脚本位于用户命令之前，且路径中的单引号被转义；`tests/host/file-config.spec.ts` 覆盖 `shellJobDir` 跟随 `NAVO_HOME`。
- shell 两个测试套件显式设 30 秒超时（`SHELL_TEST_TIMEOUT_MS`）。修复前满载全量测试中，简单 shell 命令已需 2–2.8 秒；本修复后，每个文件的第一条命令还要在满载下承担一次性编译。冷启动 15 轮实测 shell 用例 p50 1.4 秒、p95 6.7 秒、最大 10.4 秒（首条用例，含编译），已超过 5 秒默认值。30 秒仍能识别真正的挂起（挂起是永不返回）。做法与 F10.1a 给 Host 进程测试设显式超时相同。

## 验证结果与边界

本机：Windows 11 Pro 10.0.26200，Node 22.23.1，pwsh 7（Scoop）与 Windows PowerShell 5.1。

- `pnpm typecheck` 通过；`pnpm test` 全量 505 项通过。
- 漏杀对照（启动后 200ms 取消，各 10 次）：pwsh 7 有作业 0/10、无作业 8–10/10；5.1 有作业 0/10、无作业 0/10。冷编译那一次（首次运行）同样进入作业。
- 单条命令增加的耗时（空闲，dll 已缓存，各 6 次中位数）：pwsh 7 约 +120ms（261 → 383ms）；5.1 约 +50ms。首次编译一次性开销：pwsh 7 约 1–3 秒，5.1 约 0.7 秒。满载全量测试中按 CPU 争用放大。
- 冷启动多轮全量测试：每轮先删 `node_modules/.vite` 和作业 dll 缓存（比 CI 更冷），共 40 轮。前 15 轮在 shell 套件超时为 15 秒时运行，后 25 轮为 30 秒，每轮结束 2 秒后按命令行特征查残留 node。结果：0 挂起、0 残留；39 轮 505/505 通过，1 轮（30 秒设置下的一次 `pnpm test`）报 1 项失败。那次未保存失败用例名称，随后热启动重跑通过，之后的 24 轮冷启动均未再现，归因未知，不能排除与 shell 无关的满载超时（见上文旁证 3）。对比修复前：冷启动 15 轮中 1 次挂起。
- CI：PR [#46](https://github.com/likeWind221/Navo/pull/46)。提交 `f08d84f` 的 CI 运行 [38253112720](https://github.com/likeWind221/Navo/actions/runs/38253112720) 跑了 3 次（原始 1 次 + 重跑 2 次，windows runner），均为 505/505 通过；本笔记提交后，最终提交的 CI 结果以 PR 为准。

未覆盖与边界：

- 命令在首次编译期间被结束，会在缓存目录留下空的 `*.tmp` 文件（本机观察到 1 个）。不影响正确性（dll 只经原子改名产生），目前不做清理。
- 5.1 的 `Add-Type` 编译会启动 `csc.exe`。编译发生在进入作业之前，若此时被取消，仍只靠 taskkill `/T` 清理。仅首次编译可能遇到。
- 宿主进程本身所在的作业若禁止嵌套或子作业，`AssignProcessToJobObject` 会失败并走退回路径，此时仍可能漏杀。本机与 CI 均未遇到。
- 非 Windows 路径未改动，未在本次重新验证 POSIX 进程组行为。

## 后续

- 无必须跟进项。若出现嵌套作业失败或长期运行服务的需求，再评估“退回路径时补杀残留”或为后台服务提供独立工具。
