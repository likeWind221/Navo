# 60：CI 与 PR 流程接入

## 做了什么

- 新增 `.github/workflows/ci.yml`：在 PR 与 `master` push 时运行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`，runner 为 `windows-latest`。
- `AGENTS.md` 新增「Step 分支与合并」：一个 Step 一个分支、PR 触发 CI、绿灯后 `gh pr merge --squash --delete-branch`，本机与 CI 双重验证。
- 通过 PR #3 完成 CI 配置落地，并修复 CI 暴露的文件测试路径问题。

## 关键决策

- runner 选择 `windows-latest`：当前开发与支持平台是 Windows，测试套件带有 Windows 假设；Linux 可移植性不属于本轮目标。
- 合并统一走 squash，保持「一个 Step 一条 `master` 提交」，功能分支合并后自动删除。

## 坑与发现

- 首次在 `ubuntu-latest` 运行失败，与业务无关：`tests/tools/shell/execution.spec.ts` 默认 shell 假定 PowerShell 且 POSIX 单引号拼装脚本存在引号 bug；`tests/host/process.spec.ts` 的 SIGTERM 退出码语义在 Linux 下不同。
- 换到 `windows-latest` 后，`tests/tools/file/write.spec.ts` 与 `tests/tools/file/edit.spec.ts` 因 `tmpdir()` 返回 8.3 短名、工具输出规范长名而失败；已在两个测试中用 `realpath` 规范化临时目录。
- GitHub Actions 提示 `actions/checkout@v4`、`actions/setup-node@v4`、`pnpm/action-setup@v4` 目标 Node 20 已弃用，目前仅为告警。

## 下一步

- Linux 可移植性作为独立任务：修复 shell 测试的平台假设与 host 进程 SIGTERM 断言后，可扩展为双平台 matrix。
- 可选：升级 Actions 版本以消除 Node 20 弃用告警。

## 2026-10-21：CI 文档分流与重复运行简化

### 做了什么

- 保留单个 Windows `verify` job、15 分钟预算、Node 24、pnpm 缓存和完整测试命令；不调整测试、worker 或单项超时。
- PR Checkout 使用两层历史，比较 GitHub 合并提交与第一父提交。只有所有变更都匹配 `_docs/**/*.md`、根目录 `README.md` 或 `AGENTS.md` 时，才跳过环境初始化、依赖安装、类型检查和测试，并明确报告未运行代码检查。
- 代码、配置、未知路径、空差异以及手动 `workflow_dispatch` 均运行完整检查。Git 比较出错直接失败；禁用重命名识别，避免代码改名为文档后遗漏旧代码路径。
- 移除 `master` push 触发，避免 PR 通过合并后重复执行；保留同一 PR 新提交取消旧运行。

### 关键决策

- 在 job 内分流，保留稳定的 `verify` 检查结果；不使用顶层路径过滤，不因分支名决定跳过。
- 使用明确的文档路径白名单，不把所有 Markdown 都当作可跳过输入；大小写不匹配或其他文件均执行完整检查。
- 本轮为 CI 工程治理，不推进产品 Step；续写本记录，不占用正在审核的 F13.1b 文档编号。
- 取舍：文档正确性仍依赖 review；master 合并结果不再有第二次自动复验，需要时手动完整运行。现有 CI 仍只检查根工程，不新增前端或 RPC 套件。

### 坑与发现

- 优化前 run `39441813594`：job 约 363 秒，测试约 327 秒，`tests/host/process.spec.ts` 约 323 秒；安装和类型检查各约 2 秒。该步骤减少无必要运行，不承诺缩短普通代码 PR 的六分钟关键路径。
- 文档分支预估执行 15–40 秒，不含 runner 排队；代码 PR 合并前后由两次完整运行变为一次，runner 占用预计约减半。以上是预估，不作为实测结果。

### 验证与边界

- 本地从工作流提取实际 PowerShell 分类脚本，在真实两父提交、深度 2 的临时 Git clone 中验证：纯文档、中文文件名、根目录文档、混合改动、工作流、未知路径、代码改名为文档、删除文档和空差异，均符合预期。
- 手动入口强制完整检查、Git 比较失败返回非零，以及初始化/安装/类型检查/测试步骤的条件均已核对。
- 本地使用 Windows、bundled Node 24.19.0，System32 前置；独立 worktree 安装遇到 npm 下载超时，改用主目录现有依赖的 junction。本机 pnpm 包装器尝试自动安装并拒绝跨目录 modules，故直接执行 package scripts 对应的 `node node_modules/typescript/bin/tsc --noEmit`（通过）和 `node node_modules/vitest/vitest.mjs run --maxWorkers=4`；未修改依赖或锁文件。
- 本地完整验证通过：类型检查 exit 0；135 文件 / 856 项测试全部通过，耗时 271.17 秒。`git diff --check` 通过。
- GitHub 冻结安装、类型检查和完整测试结果保留在本次 PR 的 Checks；合并必须以当前 head 检查成功为前提。实际 GitHub 文档分支和手动入口尚未运行，本地分类验证不等同于这些入口的线上实测。

### 下一步

- 按当前 PR head CI 门禁收口；慢进程测试优化不属于本轮范围。

## 2026-10-21：Other 路线分阶段与分级验收

### 做了什么

- 保留单个 Windows `verify` job，Docs only 分类、Node 24、pnpm 缓存、冻结安装和类型检查不变；不新增 job、依赖或生产配置。
- 代码检查分为普通测试（4 worker）和崩溃恢复测试（1 worker）两个顺序阶段，避免真实 Host 子进程与其他文件/SQLite 测试竞争。
- PR 运行 848 项普通测试及 D6 / D8 两个真实中断场景，各一次正式 Host 恢复；手动 `workflow_dispatch` 运行普通测试及 D1–D8 完整矩阵，各两次正式恢复。
- 所有保留场景仍使用真实 SIGKILL、自然锁过期、同 operationId 重试以及原数据库、文件、RPC、其他资源保护断言；不调整锁时间、持久化强度或测试超时。
- 正式 Host 的恢复计时细分为 ready、assertions、dispose、exit；不把阶段计时总和与并行套件的墙钟耗时混淆。

### 关键决策

- `NAVO_TEST_MODE` 只由测试入口读取：未设置或 `all` 保持本地完整套件；`normal` 不注册崩溃矩阵；`crash-pr` 选择 D6 / D8 及一次重启；`crash-full` 选择八项及两次重启。未知值在收集阶段报错。
- 没有删除 D1–D8：日常 PR 只覆盖事务提交前回滚（D6）与提交后清理恢复（D8）；其他真实中断点与第二次正式恢复的幂等性保留在完整验收。精简通过不等同于完整验收通过。
- 修改资产生命周期/恢复、SQLite 存储/事务/迁移、Host 生命周期/用户锁、崩溃测试/探针/夹具时，合并前必须手动运行当前分支 head 的完整 CI；发布前同样执行。核对 Actions `headSha` 与当前 PR head，不能仅凭精简 `verify` 成功自动合并。
- 此完整验收要求是开发流程门禁，本轮未新增路径自动判断或 branch protection。分支追加提交后必须重新核对 head；旧 head 的完整成功不能替代新 head。
- 保留 `process.spec.ts` 单文件串行所有权，避免默认本地完整运行的测试争用同一 OS 用户锁。该文件已超过 300 行，本次仅增加入口选择和既有 Host helper 的计时回调，不做历史场景重构；新增辅助配置与接口留在既有 `process/interruption.ts`。
- 本轮属于 CI 工程治理，不推进产品 Step；不修改 Agent 协议或生产生命周期，因此不引入 Harness 机制或额外生产测试开关。

### 使用方式

```powershell
pnpm typecheck
pnpm test --maxWorkers=4

$env:NAVO_TEST_MODE = 'normal'
pnpm test --maxWorkers=4
$env:NAVO_TEST_MODE = 'crash-pr'
pnpm test tests/host/process.spec.ts --maxWorkers=1
$env:NAVO_TEST_MODE = $null

gh workflow run ci.yml --ref <当前PR分支>
```

前两行在未设置 `NAVO_TEST_MODE` 时运行本地完整套件；中间命令复现精简分阶段执行，完成后清除环境变量；手动工作流始终走完整模式。单独复现完整崩溃组时，将模式设为 `crash-full` 并限定 `tests/host/process.spec.ts`。

### 验证与实际边界

- 优化前基线：PR #84 的 run `39534323704` 为 856 项通过，job 350 秒；D1–D8 约 277 秒。Docs only 的临时 PR #85 / run `39535240672` 已实测 job 18 秒、触发到完成约 23 秒，测试 PR 已关闭且分支已删除。
- 测试收集核对：`all` 856 项、`normal` 848 项、限定进程入口的 `crash-pr` 2 项及 `crash-full` 8 项；未知模式被拒绝。类型检查已通过。
- Windows / bundled Node 24.19.0，System32 前置；复用主目录现有依赖，不修改清单或锁文件。执行 `node node_modules/typescript/bin/tsc --noEmit` 通过；清除模式变量后执行 `node node_modules/vitest/vitest.mjs run --maxWorkers=4`，135 文件 / 856 项全部通过，279.72 秒，验证本地默认完整行为。`git diff --check` 通过。
- GitHub 精简/完整的当前 head 运行链接、结果和实测耗时统一登记于本次 PR 描述与 Actions，合并前逐项确认。普通 PR 目标为 job 三分钟以内，不包含 GitHub 排队，不宣称每次运行均有硬性耗时保证。

### 下一步

- 以当前 head 的线上精简 CI 和手动完整 CI 共同作为本轮合并门禁；若仍超过三分钟，依据新阶段计时定位，不自动进一步削减覆盖。
