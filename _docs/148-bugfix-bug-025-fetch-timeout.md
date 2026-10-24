# BUG-025：固定地址 HTTP 测试偶发超时

## 现象与复现

2026-10-24，F13.3d 分支首轮 `pnpm test --maxWorkers=4` 在 Windows PowerShell / Node v24.19.0 下运行 325.75 秒，152 文件 / 980 项中 979 项通过。`tests/tools/fetch/network.spec.ts` 的 `connects to a pinned address without resolving the URL hostname` 超过默认 5000 ms，报告该场景 6911 ms。该测试使用本机临时 HTTP Server 与固定回环地址，不访问真实外部网站。

## 已证实事实与根因假设

- 本轮没有修改该测试、Fetch 网络代码或其直接依赖；与 origin/master 的对应路径 diff 为空。
- 同分支随后运行 `pnpm exec vitest run tests/tools/fetch/network.spec.ts --maxWorkers=1`，1 文件 / 7 项通过，测试 103 ms、总用时 579 ms。
- 单次完整套件超时与单项成功不能确定原因，也不能证明不存在偶发问题。并发负载或本机调度是待验证假设，不作为已确认根因。

## 修复内容

仅排查，未修复。没有修改网络实现、测试断言、超时、并发预算或全局测试配置；不为通过门禁隐藏首轮失败。

## 验证结果与边界

`origin/master` 的干净 detached worktree（ccb081f）使用同一 Node 24 与依赖运行相同定向命令，7 项通过，测试 106 ms、总用时 473 ms。分支与 master 的定向都未复现超时，因此对照不能建立首轮超时的因果归属。同分支完整复验结果见下文。F13.3d 自身专项与 typecheck 已通过，阶段记录见 [147](147-devlog-f13-3d-retrieval.md)。本项仍未关闭，不以定向成功代替完整套件。

第二轮同分支相同完整命令 `pnpm test --maxWorkers=4`：152 文件 / 980 项全部通过，用时 279.98 秒。该结果满足本次本机完整检查，但没有修复或定位本项偶发超时；BUG-025 继续保持未勾选。当前代码 head CI 结果待补。

## 后续

若复发，补充连接、响应与关闭阶段的现场耗时，再决定是否需要独立修复；不凭一次超时调整预算。关闭需定位原因、实施必要修复，并完成相关回归、本机完整验证与当前 PR head CI。

跟踪入口：[bug-plan.md](bug-plan.md)。
