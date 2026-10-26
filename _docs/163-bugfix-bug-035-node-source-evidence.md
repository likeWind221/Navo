# 163：BUG-035 第二 Node 的来源声明与实际原文读取不一致

日期：2026-10-26。所属：后端验收脚本 / 来源契约，优先级 P1。状态：**已修复，待真实复验**。跟踪项见 [Bug 表](bug-plan.md)，完整运行记录见 [160](160-devlog-f13-6-openrouter-acceptance.md)。

## 现象与复现

用户明确授权在补齐 Main 目标确认回合后，再执行一次完整真实验收。运行在 node-b 阶段因 `Source IDs must identify actually fetched Resources` 停止，耗时 175790ms；未重跑。

## 已证实事实与根因假设

- 真实导入、3 份源资料索引与图谱、Main 确认与规划、Node A 搜索及读取全部三份原文、Main 审查实际成果并定向共享、同库重开状态和请求数不变均通过。
- Node B 实际成功调用 fetch_resource 两次，读取 comparison.md `2110e4bc-18c0-4c9c-99f2-0b23500990e8` 和 constraints.md `e332281a-a896-46b9-8f99-ad5e4cf4ad71`，并执行一次 search_resources。
- Node B 的 source_ids 除这两个 ID 外，另列 measurements.md `37479cdf-910e-4bab-9ff5-5b3fc0577678` 和 conflict.md `3ba91738-6286-4695-b73a-f94503e85db7`；它本回合没有 fetch 这两份原文。其 criteria.note 自述“Constraints and comparison were fetched; searched snippets verified supporting score/conflict evidence.”，与当时检查器要求的“source_ids 仅列实际 fetch”不一致；该要求在判据或任务文本中并未明确，见下方修正。
- 数值、预算、未解决冲突、未知部署成本和所需两个 fetch 的断言已通过；失败不是数值错误或没有读取交接成果。上游答案中的来源和搜索片段可以提供信息，但不能代替本轮约定的直接原文读取记录。
- 首次排查时认为输出违反验收要求；进一步核对确认失败来自检查器未声明的额外约束，不是数值错误、ACL 泄漏、检索丢失或生产状态机错误。

## 首次排查时的处理

**当时无修复。** 未替模型修改答案、未补造 fetch、未放宽来源校验，未将上游来源自动视为 Node B 直接读取，未重跑。Node B 已提交，但最终 Main Review、最终成果物化和整体 passed 尚未执行到。

## 验证结果与边界

- 本次生成适配器调用计数 18（4 次图谱），Embedding 6 次全部 HTTP 200；comparison.md 的索引和图谱亦 active。账本完成状态缺口仍按 [160](160-devlog-f13-6-openrouter-acceptance.md) 披露，不据此虚构 HTTP 完成统计。
- 现场 `C:/Users/likeW/AppData/Local/Temp/navo-f136-real-3yfalI/`，证据 `evidence/5-node-b.json`、`failure.json`、`restart.json` 与 `navo.db`；日志 `%TEMP%/navo-f136-openrouter-20261026/real-confirm.log`。
- 完整本地与 CI 结果见 [160](160-devlog-f13-6-openrouter-acceptance.md)；离线通过不能关闭这个真实输出问题。

## 后续

先决定来源声明与实际原文读取的处理范围，保留失败证据；若要真实复验，另行授权调用预算。关闭需来源声明与成功工具轨迹一致，并完成最终 Main Review 和完整任务。

## 2026-10-26：进一步定位与修复方案（仅排查，未修复）

### 定位结论

直接触发原因已确认：模型将直接读取、上游引用和搜索片段中的来源混入同一 source_ids 列表；验收要求该列表每项都对应当前 Node 本回合成功的 fetch_resource，因此列表 4 项与实际 fetch 2 项不一致。

两份额外原文确实出现在 Node B 的 search_resources 结果中，comparison.md 也包含上游来源。因此不是凭空捏造 Resource ID，也不能笼统写成“没有看到这些资料的任何内容”；只能确认没有在本回合直接 fetch 这两份原文。为什么模型忽略字段限制，尚不能从一次输出确定其内部原因。

代码边界：

- `scripts/library.ts:74` 仅在示例 JSON 的 source_ids 中用 “actually fetched Resource IDs” 表达限制，没有单独说明搜索片段、上游答案内的引用和本回合直接读取之间的边界；Node B 另被要求读取交接和约束两份，实际已经做到。加强任务说明是针对现有失败的改进，不代表单靠提示即可保证不再发生。
- `scripts/longterm/evidence.ts:25` 按 turnId 筛事件；`scripts/library/checks.ts:19–24` 从成功 fetch 生成集合，并拒绝 source_ids 中任何不在该集合内的值。失败由独立验收判据触发，判据没有漏算本回合已有的 fetch。
- `src/tools/builtins/node/submit.ts` 的 summary 是通用字符串；工具校验提交结构、交付 Resource 可见性与逐项标准，不解析这个验收特有 JSON 内的 source_ids。resource_ids 指交付成果，不是阅读来源。Node 保持 submitted 等待审查，提交成功不代表系统已认可来源声明。
- `scripts/library.ts:116` 在最终 Review 前调用 validateAnswer，失败后不会执行后面的 review-b。因此本次不能用于判断 Main 是否会发现来源声明问题并要求返工，也没有证据证明 Main 错误批准了 Node B。
- `tests/integration/library/report.spec.ts` 已覆盖只列目录、不读原文却声称读过的拒绝场景，但未覆盖“已读要求的两份，又额外列出两份未 fetch 来源”。离线主流程用固定模型脚本，不能证明真实模型会按该字段约定作答。

### 当时推荐的最小修复范围（已被下方方案 A 取代）

> 下方第 2 条“保持现有严格判据”在进一步核对后修正：判据只要求“至少两份真实 fetch”，检查却要求 source_ids 全部对应当回合 fetch，二者不同义。最终改为由工具轨迹证明直读，source_ids 只校验可追溯性。

1. 只在本验收入口明确 source_ids 的含义：仅列本回合成功 fetch_resource 的 Resource；搜索片段和上游成果内的引用不等于亲自读取。Node B 可以只列 comparison.md 与 constraints.md；若要将其他原文列入，必须实际读取。允许利用上游成果推理，不要求下游为形式重复读取所有原文。
2. 保持现有严格判据，不自动删除错误来源或替模型补造读取；补充“读两份 / 列两份通过”和“读两份 / 额外列未 fetch 来源拒绝”的离线回归，确保准确区分内容正确与来源声明正确。
3. 不在通用 submit_completion 中硬编码 Atlas JSON，不新增独立引用追踪、数据库结构、RPC 或状态缓存；F13.5 仍维持取消状态。若今后要让系统强制校验通用结构化来源，应作为独立产品需求设计，而非借此 Bug 偷渡。
4. 本地相关检查及合并要求通过后，另行报告预算并获授权，再做真实完整验收；验收需来源声明正确并实际执行最终 Main Review。提示改进和离线通过都不能单独关闭 BUG-035。

本次仅核对原始证据和源码、更新定位记录与跟踪表；没有修改代码、运行推理或重跑测试。

## 2026-10-26：按方案 A 修复（已实施）

### 结论修正

进一步核对确认：直接失败点是验收脚本的来源字段契约，不是产品内核缺陷。产品链路到 Node B 提交为止通过；`submit_completion` 只做通用结构校验；Node B 的最终 Main Review 未执行。原先“保留严格判据、只加强提示词”的方案会让判据（至少两份真实 fetch）与检查（source_ids 只能列 fetch）继续不同义，因此改为：**直读由成功 fetch 轨迹证明，source_ids 只要求可追溯的支持来源**。

### 修复内容

1. [scripts/library/checks.ts](../scripts/library/checks.ts)：保留 `fetched.size >= 2` 与必读来源全部实际 fetch；删除 `source_ids` 必须全部等于 fetched 集合的断言。新增 source_ids 非空、去重、至少两项、包含必读来源；每个 ID 必须出现在本回合成功 `fetch_resource` / `search_resources` 的结果文本中，拒绝本回合从未出现过的 ID。
2. [scripts/library.ts](../scripts/library.ts)：schema 的 source_ids 改为 “supporting Resource IDs”，并明确必须包含本回合完整读取的来源；搜索片段或上游成果中的引用可以列入，但不得声称亲自 fetch。
3. [tests/integration/library/report.spec.ts](../tests/integration/library/report.spec.ts)：保留“只列目录、不读原文”的拒绝回归；新增“读两份 + 搜索到第三份 + 列三份通过”的 BUG-035 原样回归；新增“列本回合未出现 ID 拒绝”的回归。

### 验证结果与边界

- `pnpm typecheck` 通过（本机 Node v22.23.1；仓库基线为 Node ≥24，完整测试改用 bundled Node v24.21.0）；bundled Node 24 下另行执行 `tsc --noEmit` 亦通过。
- `tests/integration/library`：3 文件 / 11 项通过，包含新增 3 项。
- 完整本地：165 文件 / 1056 项全部通过，366.95 秒（bundled Node v24.21.0，`NAVO_TEST_MODE=all`，`--maxWorkers=4`）；日志 `%TEMP%/navo-bug035-full.log`。
- 本地提交已完成；2026-10-26 21:50 尝试推送 `origin/phase13-f13.6-openrouter-acceptance` 失败（github.com:443 连接超时），当前 head CI 与远端 PR #105 尚未更新。
- 未执行真实推理、未重跑真实验收、未修改产品代码。BUG-035 仍保持未勾选，需真实运行中 Node B 来源校验通过并完成最终 Main Review 后再关闭。
