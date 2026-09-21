# 61：CI 与 PR 流程接入

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
