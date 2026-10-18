# BUG-016：Main 将合法提交的自检结构当作不可核验而反复返工

> 日期：2026-10-18
> 状态：审查清单与系统规则已修订，离线验证见末节；待真实模型复验，尚未关闭
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

## 首次排查结论（修订前）

仅排查，未修改生产代码、任务提示、验收条件或测试。不能手工把 Main 的 escalate 改为 complete，不能删除结构断言让本轮通过。

建议下一次先收口审查契约：明确区分已持久化且经过运行时校验的提交结构事实，与仍需 Main 独立核验的任务成果；以现有归一化自检字段表达索引与布尔值，不要求从截断日志反推原始 wire 参数。若需改动，优先修正清单与审查提示的来源说明，避免重复状态、放大全部工具日志或扩大 Node 权限。此处是待审方案，不是已采用或已实现的设计。

## 验证结果与边界

- 当前代码 head a478b76 的本机类型检查、专项 14 项、完整 785 项及 [CI run 39110793453](https://github.com/likeWind221/Navo/actions/runs/39110793453) 均通过；本轮没有代码改动，不重复这些检查。
- 本次真实暂停、JSON 交接与重启已通过，完整 Main / Node B / roadmap-complete 未通过。BUG-014 / BUG-015 原关闭条件包含完整真实完成，继续保持未勾选，并单独记录已验证部分。
- 不宣称真实服务端容量、真实超窗、硬崩溃或 Renderer UI 验收通过。失败现场保留，未重新打开 App 执行恢复写入，诊断零新增模型请求。

## 首次排查后的安排（历史）

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

## 2026-10-18 审查来源契约修订

### 做了什么

用户明确授权修复，不调用 worker。从最新 `origin/master` 创建 `fix/bug-016-review-submission`，串行 fast-forward 纳入未合并的 F12.7 现场与脚本，再实施本次后端修订；最终仍经 F12.7 草稿 PR #79 集成，不绕过真实验收门禁。

- `src/project/checklist.ts`：`buildChecklist` 继续只读取当前 Node snapshot。外层 `criteria` 只保留条件索引与文本；实际自检统一放在 `completionSignal.criteria`，包含 1-based `index`、原始布尔 `satisfied` 与裁剪后的 `note`，不再把同一事实转成另一组 `claims-satisfied` 字符串。`completionSignal.source=validated-node-submission` 标记结构经过校验的当前提交；无提交时仍为 null。summary / note 既有裁剪限额不变，完整自检布尔值不裁剪。
- `src/project/profile.ts`：Main 系统规则明确区分提交事实与任务声明；按清单确认提交值，按产物与执行记录核验任务。禁止仅因截断日志省略字段而要求重新提交；保留证据不足或矛盾时 rework / escalate 的职责，合法提交本身不能推出 complete。summary、note 等仍是数据，不能成为批准指令。
- `tests/project/runtime/provenance.spec.ts`：新增真实 Runtime + 脚本模型的四项回归，覆盖长参数截断下 true / false 自检、未完成项与缺失 / 重复条目拒绝。旧代码两项失败，新代码全部通过；验证实际模型请求与状态，未将脚本决策冒称 Luna 行为。新增时曾与既有 submission.spec.ts 重名，检查时已恢复原文件并独立命名，原有三项测试全部保留。
- `tests/project/runtime/mainreview.spec.ts`：更新清单来源断言；既有完成、返工、升级与权限校验继续运行。没有修改提交 Schema、Node 状态机、日志截断规则、生产权限、前端或验收标准。

### 关键决策与验证边界

不新增第二份 submission 状态，不扩大日志上限，不依靠模型调整参数键顺序；索引和值直接来自已校验、持久化的单一数据源。当前改动只有清单生成和提示内容，无新增生命周期、取消或错误分支。运行时仍允许合法 satisfied=false，业务真实性由 Main 审查，未新增自动批准。

本机历史文档所指的 `deepseek-harness/packages/core/session/src/request-header.ts` 与 `surface.ts` 快照目前不存在；本修复未改 Session / Agent 协议、请求投影或取消机制，不声称完成了本次 Harness 源码对照，也不引入其机制。

新增回归修订前为 2 失败 / 2 通过，修订后 4 项通过。定向审查、返工与压缩检查通过。恢复原测试后，Windows / bundled Node 24.19.0 / System32 与 Node bin 前置 PATH，`node node_modules/typescript/bin/tsc --noEmit` 通过，`node node_modules/vitest/vitest.mjs run --maxWorkers=4` 共 128 文件 / 789 项通过（45.41s）。当前 PR head CI 单独核对，不用旧 head 结果代替。

真实 gpt-6-luna 复验本轮未运行；BUG-016 与 F12.7 保持未关闭。下一步在离线与当前 head CI 通过后，单独授权一次真实复验，验证 Main 能独立审查并使两 Node 完整完成；不能仅以字段或提示断言通过宣称模型问题已经解决。代码导读随本轮最终回复交付。

### CI 超时修订

代码提交 `092fda4` 的 [CI run 39114145817](https://github.com/likeWind221/Navo/actions/runs/39114145817) 类型检查通过，测试为 788 通过 / 1 失败；失败是既有 `tests/integration/compaction/overflow.spec.ts` 的正常超窗恢复用例实际耗时 8115ms，超过默认 5000ms，并非新增审查断言失败。仅该用例增加 15000ms 上限，与此前两个压缩集成用例一致；未增加重试、全局超时或删除任何断言。后续完整本机与新 head CI 仍须通过，不复用旧结果。

超时修订后，同一 Windows / Node 环境的类型检查再次通过，完整 128 文件 / 789 项通过（46.39s）；提交后继续核对当前 PR head CI。
