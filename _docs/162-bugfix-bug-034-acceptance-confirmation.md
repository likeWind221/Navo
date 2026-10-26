# 162：BUG-034 完整验收脚本缺少 Main 目标确认回合

日期：2026-10-26。所属：后端验收脚本，优先级 P1。状态：**脚本已修正，待真实复验**。跟踪项见 [Bug 表](bug-plan.md)，运行记录见 [160](160-devlog-f13-6-openrouter-acceptance.md)。

## 现象与复现

用户授权将 Embedding 单次超时改为 60 秒后执行一次完整验收，现场 `%TEMP%/navo-f136-real-SDBHo0`。三次 Embedding 全部 HTTP 200，三份向量索引与图谱全部 active，Main 首回合 completed，但没有创建 Node；验收入口因 `0 !== 2` 在 41993ms 后停止。

## 已证实事实与根因假设

根因已确认是验收脚本与现有 Main 目标确认规则不一致，不是模型拒绝合法工具或生产规划回归。

- Main 固定规则要求先复述目标并等待 Human 明确同意，直接要求规划不替代第二回合确认。
- 原 `scripts/library.ts` 只发一次“Create exactly two ...”后立即断言两个 Node 存在。
- 模型实际回复完整复述目标并询问是否创建 Compare / Recommend；没有工具调用、工具错误或 Node。证据在 `evidence/1-plan.json` 与 `failure.json` 的 assistant-message 中。
- 既有 `scripts/longterm.ts` 已使用“请求规划→断言无计划→明确确认→断言两个节点”的真实验收流程；本次复用相同语义，不修改 Main 规则。

## 修复内容

`scripts/library.ts` 将请求保存为 planRequest：先运行 confirm 回合，断言 Roadmap 不存在、Node 数为 0、项目目标不变；再由可信 Human 验收驱动明确同意刚复述的已记录目标，运行 plan 回合，继续既有两个 Node、依赖和实际执行断言，并再次检查目标未改变。模型没有绕过确认，脚本没有代替模型直接创建 Node。

## 验证结果与边界

- 验收入口严格类型检查、差异检查及零推理预检通过；预检现场 `%TEMP%/navo-f136-real-oVoqF6`，0 请求。
- 用户随后明确授权“做，用修正脚本再验收一次”，使用独立临时库，仍为 48 次生成 / 20 次 Embedding / 20 分钟、单项 Embedding 60 秒、失败即停。真实结果待完成后追加。
- 完整本地测试、当前 PR head CI 与真实流程均通过前保持未勾选；不把这一失败登记成生产规划缺陷。

## 后续

以修正后的真实两回合流程及后续任务验证是否满足关闭条件；原失败现场与输出保留。

## 修正后的真实复验

第三轮在 `%TEMP%/navo-f136-real-3yfalI` 实际通过 confirm / plan 两回合，目标未改变，创建两个依赖 Node，并完成 Node A、Main Review、定向共享、同库重开及 Node B 提交。本项脚本错误没有复现；完整任务被独立 [BUG-035](163-bugfix-bug-035-node-source-evidence.md) 阻断。类型检查与本地完整 1054 项通过，最终 head CI 待核对；未在原失败库续跑。
