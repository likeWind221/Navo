# 163：BUG-035 第二 Node 的来源声明与实际原文读取不一致

日期：2026-10-26。所属：后端真实验收 / 模型输出，优先级 P1。状态：**仅排查，未修复**。跟踪项见 [Bug 表](bug-plan.md)，完整运行记录见 [160](160-devlog-f13-6-openrouter-acceptance.md)。

## 现象与复现

用户明确授权在补齐 Main 目标确认回合后，再执行一次完整真实验收。运行在 node-b 阶段因 `Source IDs must identify actually fetched Resources` 停止，耗时 175790ms；未重跑。

## 已证实事实与根因假设

- 真实导入、3 份源资料索引与图谱、Main 确认与规划、Node A 搜索及读取全部三份原文、Main 审查实际成果并定向共享、同库重开状态和请求数不变均通过。
- Node B 实际成功调用 fetch_resource 两次，读取 comparison.md `2110e4bc-18c0-4c9c-99f2-0b23500990e8` 和 constraints.md `e332281a-a896-46b9-8f99-ad5e4cf4ad71`，并执行一次 search_resources。
- Node B 的 source_ids 除这两个 ID 外，另列 measurements.md `37479cdf-910e-4bab-9ff5-5b3fc0577678` 和 conflict.md `3ba91738-6286-4695-b73a-f94503e85db7`；它本回合没有 fetch 这两份原文。其 criteria.note 自述“Constraints and comparison were fetched; searched snippets verified supporting score/conflict evidence.”，与本轮要求 source_ids 仅列实际 fetch 的来源不一致。
- 数值、预算、未解决冲突、未知部署成本和所需两个 fetch 的断言已通过；失败不是数值错误或没有读取交接成果。上游答案中的来源和搜索片段可以提供信息，但不能代替本轮约定的直接原文读取记录。
- 已确认输出违反验收明确要求；尚未定位是否需要调整模型任务说明、成果来源语义或审查流程，不把它定性为 ACL 泄漏、检索丢失或生产状态机错误。

## 修复内容

**无修复。** 未替模型修改答案、未补造 fetch、未放宽来源校验，未将上游来源自动视为 Node B 直接读取，未重跑。Node B 已提交，但最终 Main Review、最终成果物化和整体 passed 尚未执行到。

## 验证结果与边界

- 本次生成适配器调用计数 18（4 次图谱），Embedding 6 次全部 HTTP 200；comparison.md 的索引和图谱亦 active。账本完成状态缺口仍按 [160](160-devlog-f13-6-openrouter-acceptance.md) 披露，不据此虚构 HTTP 完成统计。
- 现场 `C:/Users/likeW/AppData/Local/Temp/navo-f136-real-3yfalI/`，证据 `evidence/5-node-b.json`、`failure.json`、`restart.json` 与 `navo.db`；日志 `%TEMP%/navo-f136-openrouter-20261026/real-confirm.log`。
- 完整本地与 CI 结果见 [160](160-devlog-f13-6-openrouter-acceptance.md)；离线通过不能关闭这个真实输出问题。

## 后续

先决定来源声明与实际原文读取的处理范围，保留失败证据；若要真实复验，另行授权调用预算。关闭需来源声明与成功工具轨迹一致，并完成最终 Main Review 和完整任务。
