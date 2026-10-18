# BUG-017：Node B 审查缺少可直接读取的原始材料证据

> 日期：2026-10-18
> 状态：仅排查，未修复；F12.7 完整真实验收未通过
> 跟踪：[bug-plan.md](bug-plan.md)；阶段：[117](117-devlog-f12-7-acceptance.md)；前置修订：[120](120-bugfix-bug-016-review-submission.md)

## 现象与复现

用户授权启动一次真实复验，由 Codex 直接执行，无 worker、无自动重跑。代码 head `85d8fd6` 的类型检查、128 文件 / 789 测试与 [CI run 39114369085](https://github.com/likeWind221/Navo/actions/runs/39114369085) 均已通过。沿用 gpt-6-luna、32768 压缩阈值、20 分钟 / 48 请求（含摘要）的原协议。

2026-10-18 17:15:25–17:18:23（北京时间），177685ms、24 请求（22 任务 / 2 摘要），runner exitCode=1。Node A 一次审查 complete、零返工；Node B 执行并提交正确结果，但 Main 因无法从截断工作日志独立核验原始数值而 escalate，AutoRun 暂停。

- 证据：`C:/Users/likeW/AppData/Local/Temp/navo-f127-luna-20261018-171524/`，含 preflight、handoff、before-restart、restart、failure、runner-start、runner-exit、只读 review-diagnostic。
- 日志：同路径后缀 `-run.log`。
- 数据库：`C:/Users/likeW/AppData/Local/Temp/navo-f127-storage-sQ48fL/navo.db`。
- Workspace：`C:/Users/likeW/AppData/Local/Temp/navo-f127-workspace-K7Z7yr`。

## 已证实事实与根因假设

- Node A 原始 JSON 和 Node B 原始 final JSON 均由 `validateSummary` / `validateFinal` 与确定性 fixture 独立校验通过：80 条、3958 总和、20 异常，批次与抽查数值正确。这是脚本侧核验，不冒称 Main 已独立核验数值。
- Node A 十次顺序读取、Node B 读取 summary 后顺序读取批次 1 / 5 / 10 均成功；两个 Node 均零返工。两次 pressure 压缩 39416→18285、39969→18255 均完成并有后续任务请求。
- 审查前暂停、原始 JSON 原样交接、同库重启的完整状态严格比较通过，请求数 13→13→13，无自动恢复请求。
- Main 两次审查均只调用 read_node、read_node_turn、submit_review。六次实际模型请求均含新的 validated-node-submission 来源；Main 无压缩。它明确接受自检结构与空数组，未再要求从日志重建 criteria，BUG-016 的目标误判本轮未复发。
- 对 Node B，Main 区分了自检声明与业务真实性：认可读文件顺序、提交结构，但指出工具结果片段不足以复核抽查计数、总和及异常数。此处不能把拒绝仅凭 Node 自述批准任务定为 Main 审查错误。
- `src/tools/builtins/project/turnlog.ts` 将每次工具结果限制为 300 字符；原始文件有大量 filler，片段不含全部 RECORD。唯一已发布 Resource 是 Main-owned public 的 summary.json；原始批次没有预先发布为可直接 fetch 的 Resource。`scripts/compaction/handoff.ts` 只交接 summary，尚无原始材料审查交接。
- 不能声称 Main 绝对无能力访问原文件：实际工具包含 register_resource 和 fetch_resource，`src/tools/builtins/resource/register.ts` 允许 Main 发布 Workspace 现有文件，随后可读取；本轮 Main 未选择该路径。但 `scripts/compaction/checks.ts` 的最终校验又禁止所有 Turn 使用 register_resource，包含 Main。即使模型自行走这条已有生产能力，仍会违反当前验收协议。Main 没有直接文件 read 工具。
- 已确认的设计缺口是：要求 Main 独立核验原始数值，却未准备直接可读原始证据，并在验收中禁止它自行注册这些证据。实际停止原因与限制已确认；补齐材料入口是否足以使真实模型完成仍待设计与验证。不是 Node 计算错误，也没有证据支持压缩失败。

## 修复内容

仅排查，未修改生产代码、验收条件、工具权限或任务提示；未新开 App 写入失败数据库。诊断使用只读 SQLite，零新增模型请求。

## 验证结果与边界

BUG-016 的目标行为已通过真实复验：Main 正确使用提交记录、Node A 一次通过、Node B 未因自检结构被拒。但 BUG-014 / 015 / 016 原关闭条件含完整两 Node / Main 完成，本轮仍未满足，保持未勾选。F12.7 保持进行中，PR #79 保持草稿、不合并。

## 后续

先明确 Main 独立审查的原始材料入口与允许动作，再给出最小修订方案。候选是由验收夹具预先发布不可改写的原始批次证据并提供定位信息，沿用现有 fetch_resource 分段核验；不得把脚本已知正确结果当作 Main 核验，也不能只删拒绝或强制 complete。此候选尚未采用或实施，新一次付费复验须重新授权。
