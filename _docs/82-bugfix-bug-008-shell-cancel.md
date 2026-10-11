# 82：BUG-008 shell 取消在 CI 上偶发挂起

> 状态：**仅排查，未修复**（2026-10-11）。经用户决定登记后暂停排查，等再次出现时带上诊断定位。跟踪见 [Bug 跟踪表](bug-plan.md)。

## 现象与复现

- PR [#43](https://github.com/likeWind221/Navo/pull/43)（F10.1a）CI 的第 1、2 次运行中，`tests/tools/shell/execution.spec.ts` 的 “kills the process tree on cancellation and marks the result” 等满 vitest 默认的 5 秒超时（5004ms）后失败；第 3 次运行通过。运行环境为 GitHub Actions `windows-2025-vs2026`，Node 24.21.0，shell 为 PowerShell。
- 该测试启动 `node -e "setTimeout(() => {}, 60000)"`，200ms 后取消；生产路径 `src/tools/builtins/shell/execution.ts` 在 Windows 上同步执行 `taskkill /PID <pid> /T /F`，然后等待子进程的 `close` 事件。
- F10.1a 没有修改 shell 相关代码。同一天 master 的 CI 重跑通过，该测试耗时 345ms。
- 本机（Windows 11，Node 24.14.0）无法复现：只跑 shell 测试、额外并发 2 组 `tool.spec`、取消时机覆盖 20–400ms 的 12 种情况，全部在 0.4–0.7 秒内结束。

## 已证实事实与根因假设

### CI 取证

| 轮次 | 内容 | 结果 |
|---|---|---|
| 1（PR #44 草稿，基于 master） | 启用诊断，只跑 `tests/tools/shell`：0 / 2 / 4 个并发 PowerShell 负载 × 7 种取消时机（50–400ms） | 21/21 正常，原测试也通过 |
| 2（PR #45 草稿，基于 F10.1a） | 启用诊断，跑完整套件 1 遍，并重跑 1 次 | 2/2 通过 |
| 3（PR #45） | 启用诊断，在同一 job 内连续跑完整套件 4 遍 | shell 取消 4/4 正常（312–354ms）；第 1 遍冷启动时，另一项“启动真实 Host”进程测试超时（5035ms，其余 3 遍为 750–830ms） |
| PR #43 重跑 | 不启用诊断 | 第 3 次通过 |

已证实：

1. 正常取消耗时 0.3 秒左右。taskkill 每次都返回 0，耗时 96–220ms，输出列出 PowerShell 及其 `node`、`conhost` 子进程均已终止；`exit` 与 `close` 相差不到 10ms。失败时等满 5 秒仍没有 `close`，所以是**挂起**，不是变慢。
2. 两个 shell 测试文件并发不是触发条件：失败运行中它们曾重叠约 1.3 秒，但第 1 轮人为施加的同类负载没有复现。把这两个文件改成先后跑不能证明有效，因此没有采用。
3. 开启诊断的运行共约 6 遍完整套件，加 21 次专项取消，**一次都没有复现**。诊断本身会改变时序（taskkill 的 stdio 从 `ignore` 改为 `pipe`，并增加了事件监听），不能排除它掩盖了问题。
4. 旁证：CI 和本机满载时，其他依赖 5 秒默认超时的测试也会偶发超时。例如本机完整套件中的 `tests/tools/fetch/network.spec.ts`（5059ms，单独重跑 3/3 通过），以及上表第 3 轮的 Host 冷启动。

### 根因假设（均未证实）

- **A：** taskkill 枚举进程树时，PowerShell 正在创建 `node` 子进程，新进程漏杀后成为孤儿，继续持有 stdout/stderr 管道，导致 `close` 迟迟不来。生产影响：取消后，回合要等到漏杀的进程自行退出，期间超时计时器不会再次终止进程。
- **B：** 满载时 taskkill 自身或 `spawnSync` 阻塞事件循环过久。
- **C：** 子进程已全部终止，但管道关闭事件延迟送达。

区分方法：失败时 `exit` 是否早于 `close`、taskkill 的退出码与输出，以及 2 秒后残留的后代进程。下面的诊断就是为此设计的。

## 修复内容

未修复，生产代码没有改动。诊断代码只存在于临时分支，已随草稿 PR 一起关闭和删除，没有合入 master。

### 诊断方法（复现时重新加入）

在 `runShellCommand` 中，于 `spawn` 之后加入下面的代码，用环境变量 `NAVO_SHELL_DIAG=1` 开启：

```ts
const diagOn = process.env.NAVO_SHELL_DIAG === "1";
const t0 = Date.now();
const diag = (line: string): void => { if (diagOn) process.stderr.write(`[shell-diag] pid=${child.pid} +${Date.now() - t0}ms ${line}\n`); };
let closed = false;
child.once("spawn", () => diag("spawn"));
child.once("exit", (code, sig) => diag(`exit code=${code} sig=${sig}`));
child.once("close", () => { closed = true; diag("close"); });
// terminate() 的 win32 分支：
diag("abort");
const r = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { encoding: "utf8" });
diag(`taskkill status=${r.status} out=${JSON.stringify(r.stdout.trim())} err=${JSON.stringify(r.stderr.trim())}`);
setTimeout(() => { if (!closed) diag(`STILL-OPEN tree-after=${descendants(child.pid)}`); }, 2000).unref();
```

- `descendants` 调用 `Get-CimInstance Win32_Process` 取得全部进程，按 `ParentProcessId` 展开后代，同时列出命令行包含测试特征串的进程，用来发现已脱离父进程的孤儿进程。
- **不要在 taskkill 之前拍快照**：一次查询耗时 1–3 秒，会把取消时机推迟到子进程启动完成之后，从而掩盖要观察的竞态。
- 在 CI 中用 pwsh 循环在同一 job 内多跑几遍完整套件，可以提高命中率，并且不会因单次失败而中断。

## 验证结果与边界

- F10.1a 的 PR #43 不启用诊断重跑后转绿，因此该 Bug 不阻塞 F10.1a 合并。F10.1a 同时给真实 Host 进程测试设置了显式超时，原因是 CI 冷启动轮次整体变慢时，单项启动可达 5035ms（平时为 0.75–1.3 秒）；这与 F10.1a 的改动无关，与本 Bug 分开处理。
- 未覆盖：失败现场的 `exit` / `close` 时序、taskkill 结果、残留进程树都没有采集到，假设 A/B/C 均未排除。生产环境中，取消是否会因此长时间挂起也没有观察到。

## 后续

- 再次出现时：从 master 开 `fix/bug-008-shell-cancel` 分支，加回上面的诊断，在 CI 上重复跑完整套件，直到采到失败现场，再依证据决定修法（例如 taskkill 后在超时内复查后代进程并补杀，或改用其他进程树终止方式）。
- 关闭条件：确认根因，并修复或证明不属于生产缺陷；修复后在 CI 上连续多轮完整套件无挂起，保留运行记录。
