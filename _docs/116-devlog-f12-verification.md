# F12.0–F12.6 验证与状态收口

> 日期：2026-10-18
> 状态：✅ F12.0–F12.6 已完成；F12.7 等待步骤确认

## 做了什么

- 用户授权补齐 F12.7 之前的验证；本次为唯一共享文档写入者，只修改计划、既有记录和索引，不修改生产代码或测试。
- 在 master `4ea4e80` 执行类型检查与完整后端测试，核对 F12.2 / F12.3 已合并 PR 的最终 head CI，关闭历史本机验证跟踪项。
- 将 F12.2、F12.3 标为完成，F12.0–F12.6 全部收口；F12.7 保持未开始，正式 Renderer UI 状态不变。

## 关键决策

- F12.2 原文的“越线只发事件后继续原请求”是独立交付时的阶段行为。当前 F12.3 已接入：越线先压缩、重测，无法压缩时明确失败；不为了匹配旧文档回退当前行为。
- 复用既有测试，不新增镜像测试。压力阈值与容量禁用见 `tests/context/pressure.spec.ts`、`budget.spec.ts`；真实运行时高压无有效选区失败见 `tests/agent/runtime.spec.ts`；压缩续接、两次累积压缩、回放与摘要失败见 `tests/context/compaction-runtime.spec.ts`；工具配对、检查点及过期选区见 `tests/context/compaction.spec.ts`；共用压缩核心不收缩与取消见 `tests/command/compact.spec.ts`。

## 验证结果与边界

环境：Windows PowerShell、Node 24.19.0。将 bundled Node 目录及 Windows System32 前置到 PATH，直接执行 package scripts 对应的本地入口：

```text
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --maxWorkers=4
```

- 类型检查通过；完整测试 122 文件、771 项全部通过，62.77 秒。
- [PR #74](https://github.com/likeWind221/Navo/pull/74)：最终 head `cdbd5fd99d1ae5fff20bc525af365c9ff3b1ead7`，CI `verify` 成功，合并提交 `e32f4c4`。
- [PR #75](https://github.com/likeWind221/Navo/pull/75)：最终 head `d5809ec91aacc1e5267bcaec239f9c667e1a6065`，CI `verify` 成功，合并提交 `339867d`。
- F12.6 已有后端 771 测试、前端 153 测试、build 与 Electron Bridge 实际调用验收，以及 PR #78 head CI 通过证据，见 [115](115-devlog-f12-6-public-context-contract.md)；本次无前端改动，不重复运行。
- 本次验证当前集成态，不声称回到每个历史提交复跑。未调用真实模型、未运行 F12.7 长程综合场景，也未验收正式页面 UI。

## 坑与发现

- 当前 PATH 无 `claude` 可执行程序，无法按分工调用 Claude Code；本次由 Codex 执行验证与文档收口。
- 首轮 `pnpm` 使用默认 Node 22.23.1，低于仓库要求；类型检查通过后测试被主动结束，不计作完整验收。正式结果来自上述 Node 24 命令。
- 使用 4 个 worker，避免当前 Windows 环境的过度并发；未修改测试断言、超时或依赖。

## 下一步

F12.7：证明 AutoRun Project 跨多次压缩、超窗恢复及重启后仍可完成；离线场景与真实模型小窗口均需验收，记录压缩次数、释放量和失败现场。先按步骤规则说明范围并等待确认，再创建该 Step 的分支、测试、脚本与开发记录；本次不提前创建 F12.7 文件。
