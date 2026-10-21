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
