# BUG-016：Main 将合法提交的自检结构当作不可核验而反复返工

> 日期：2026-10-18
> 状态：仅排查，未修复；F12.7 完整真实验收未通过
> 跟踪：[bug-plan.md](bug-plan.md)；阶段：[117](117-devlog-f12-7-acceptance.md)

## 现象与复现

用户明确要求“复验”，随后要求“不用 claude-worker”；本次由 Codex 直接运行，未调用 worker。使用已审查的独立 PowerShell 启动器，记录进程与退出码，仍为 gpt-6-luna、20 分钟 / 48 请求（含摘要）、32768 自动压缩阈值、原始十批材料，不改变生产权限或验收标准。

运行 228077ms、25 次请求（22 次任务、3 次摘要）后 stage2 失败，AutoRun 暂停而非 roadmap-complete。Main 对 Node A 两次 rework，随后 escalate；Node B 始终 locked。启动器收集 exitCode=1，App 正常释放，无清理错误；未自动重跑。

- 证据：`C:/Users/likeW/AppData/Local/Temp/navo-f127-luna-20261018-162301/`，含 preflight、handoff、before-restart、restart、failure、runner-start、runner-exit 及只读 review-diagnostic。
- 日志：`C:/Users/likeW/AppData/Local/Temp/navo-f127-luna-20261018-162301-run.log`。
- 数据库：`C:/Users/likeW/AppData/Local/Temp/navo-f127-storage-02i3jH/navo.db`。
- Workspace：`C:/Users/likeW/AppData/Local/Temp/navo-f127-workspace-wNPSth`。

## 已证实事实与根因假设

- Node A 首次 JSON 独立校验全部正确：80 条记录、总和 3958、20 个异常、逐批统计与异常 ID 正确。脚本在 Main 审查前成功暂停，将原始提交原样落盘并发布为 Main-owned public Resource；不将脚本写文件冒称 Node 能力。
- 同一 Node Session 三次 pressure 压缩成功：36767→17192、38933→18274、34093→12430。前两次发生在首次暂停前，第三次发生在返工续接；每个检查点都有后续任务请求。
- 首次 Node 已 submitted、没有活跃回合时暂停；交接后重启同一 SQLite，Project / Workspace / 领域状态 / Session 事件与有效历史严格相等，请求数 13→13，旧 AutoRun 不自动恢复，显式 start 后才进入审查。BUG-015 的目标暂停行为本轮实际通过，整个 Project 完成条件仍未满足。
- 只读 `node:sqlite DatabaseSync({ readOnly: true })` 提取三次 submit_completion 原始参数：长度分别 1176 / 1222 / 1267 字符，全部包含且仅包含索引 1、2，均 satisfied=true，resource_ids 与 remaining 为空；每次的前 300 字符均不包含 criterion_index。
- `src/tools/builtins/project/turnlog.ts` 将单次调用参数裁到 300 字符；翻页只切工具调用，不提供同一参数的后续片段。Main 确实无法在这个日志出口读取完整原始 criteria。
- 不能据此声称 Main 完全没有自检数据：实际三份审查提示均含 `criteria[].index`、`nodeSelfCheck=claims-satisfied` 和对应说明。`src/project/checklist.ts` 从当前 submission 映射这些字段；`src/tools/builtins/node/submit.ts` 的 checks 已校验索引范围、唯一性、完整覆盖与布尔类型，`src/node/projector.ts` 还校验与目标条件顺序一致。
- Main 已确认首轮日志的十次成功有序读取和 JSON 结构，却要求 Node 让截断日志暴露完整参数；后两次合法重新提交仍被同一理由拒绝，最终明确因无法核验 criterion_index / satisfied 升级。
- 归因置信度：现象与截断行为已确认；根因更接近审查信任语义歧义与模型误读的交互，尚不能定性为纯字段缺失或压缩遗忘。当前提示把全部清单内容笼统称为 Node 自述，模型未区分“系统已验证提交结构”与“Node 自称任务完成”。
- 次要现象：返工后 read_node_turn 只显示当前回合，Main 一度要求当前日志再次包含十次读取；最终审查仍承认首轮读日志有效，因此它不是最终升级的直接理由，也不应要求 Node 违反“只读一次”来补日志。

## 修复内容

仅排查，未修改生产代码、任务提示、验收条件或测试。不能手工把 Main 的 escalate 改为 complete，不能删除结构断言让本轮通过。

建议下一次先收口审查契约：明确区分已持久化且经过运行时校验的提交结构事实，与仍需 Main 独立核验的任务成果；以现有归一化自检字段表达索引与布尔值，不要求从截断日志反推原始 wire 参数。若需改动，优先修正清单与审查提示的来源说明，避免重复状态、放大全部工具日志或扩大 Node 权限。此处是待审方案，不是已采用或已实现的设计。

## 验证结果与边界

- 当前代码 head a478b76 的本机类型检查、专项 14 项、完整 785 项及 [CI run 39110793453](https://github.com/likeWind221/Navo/actions/runs/39110793453) 均通过；本轮没有代码改动，不重复这些检查。
- 本次真实暂停、JSON 交接与重启已通过，完整 Main / Node B / roadmap-complete 未通过。BUG-014 / BUG-015 原关闭条件包含完整真实完成，继续保持未勾选，并单独记录已验证部分。
- 不宣称真实服务端容量、真实超窗、硬崩溃或 Renderer UI 验收通过。失败现场保留，未重新打开 App 执行恢复写入，诊断零新增模型请求。

## 后续

更新草稿 PR #79 与阶段状态；确认上述审查契约修订后再修复，并先用原始现场构造定向回归。新的真实复验须单独授权，不盲目再跑当前协议。

## 2026-10-18 进一步根因定位

本次仅只读查询同一失败数据库与核对源码，未打开 App、未新增模型请求、未修改生产代码。结论是审查接口的来源与可信范围表达不完整，叠加验收条件把提交协议本身列为任务成果；原始日志截断成为触发点。模型对这些提示的具体因果敏感性仍需受控修订验证。

### 从实际请求排除传输与压缩丢失

- Main 的 9 次 `llm-requested` 快照均包含 review checklist 与自检字段，不只是数据库中存在 user-message。三个审查回合分别携带 2 / 4 / 6 个 `claims-satisfied`，对应当前与历史清单。
- Main Session 没有任何 compaction 事件；第一次审查从 2 条消息开始，已经作出同类错误返工。因此本现场不支持“Main 被压缩后忘记自检字段”或“摘要漏传字段”。Node 侧压缩也未丢掉最终提交：三次原始提交的完整字段均在。
- 三轮审查实际均调用 `read_node` 与 `read_node_turn(page=1)` 后决策，没有调用 `fetch_resource`。这不是说已充分核验任务数值；脚本独立校验正确，不等于 Main 已独立核验全部内容。

### 已定位的因果链

1. `scripts/compaction/protocol.ts:49` / `:77` 将“每条 criterion 标 satisfied、空数组、JSON summary”列为验收条件。这是对提交动作的检查，容易让 Main 要求提交参数的独立证据；它不是总和等业务结论。
2. `submit.ts:100` 的 `checks` 已校验索引范围、唯一、覆盖与布尔类型，并按目标条件顺序归一化；`projector.ts:158` 再校验持久化结构。它们证明“确实提交了哪些自检值”，不证明“这些自检宣称的业务成果是真的”。合法提交也允许 satisfied=false，不能把 submitted 等同于任务完成。
3. `checklist.ts:61` 把实际保存的布尔值转成 `claims-satisfied`，但没有明确告诉 Main“这条自检确实由本次提交保存、已完成结构校验”。`completionSignal` 本身不含 criteria，而自检在同级 `criteria` 中。清单引言与更高优先级的 `profile.ts:49` 又笼统声明全部清单未核实，掩盖了系统事实与 Node 成果自述的区别。
4. Main 因而明确声称 criteria flags 未暴露，转而依赖原始日志。实际三次 JSON 的 summary 均为 727 字符，序列化转义后 `"criteria"` 均从零基偏移 889 开始；日志只给前 300 字符。调整短 note 不会改变这一位置。分页切调用条目，不切参数正文。
5. `read_node` 的 `createAgentNodeView` 只返回定义、状态与版本，也不提供提交自检，因此不能补足 Main 所要求的原始参数证据。Main 要求 Node 保证完整参数在日志中可见，Node 两次按原结构重新提交，截断照旧，最终在两个返工额度用尽后 escalate。运行时没有把合法提交拒掉；失败决定来自 Main 的审查。

Node 理论上可以调整 JSON 键顺序，使部分目标字段落进日志前缀，但这只是绕过展示限制，不能作为稳定的审查契约；增加截断上限也不能解决字段来源语义。当前没有证据证明必须扩大 Node 权限或禁用压缩。

### 置信度与建议边界

- 已确认：三次合法提交、实际模型输入包含归一化自检、日志可见性限制、错误返工理由、Main 无压缩、两次返工后的升级。
- 高置信设计缺口：系统没有向审查方准确表达“自检值存在且已校验”与“业务完成声明仍需证据”的边界；验收条件与这个接口缺口共同触发问题。
- 尚未证明：只改哪一句提示就一定让 Luna 正确完成，以及同协议对其他模型的发生率。本次不把交互假设升级为已通过修复验证的根因。
- 后续最小修订方向：沿用唯一 submission 数据源，在审查清单与系统规则中明确来源、字段对应关系和结构校验范围；业务成果继续独立核验。对截断日志缺少字段不应要求 Node 反复提交相同内容。先做定向回归再完整检查，真实模型复验另行授权。
