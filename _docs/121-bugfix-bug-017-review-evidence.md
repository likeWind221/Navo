# BUG-017：Node B 审查缺少可直接读取的原始材料证据

> 日期：2026-10-18
> 状态：已实施修复，本机 793 项与代码 CI 通过；前轮 Main 按精简证据通过 A、B 遇 TRANSPORT；最新授权重跑在 A 的第 11 次请求再次遇 TRANSPORT，B 审查仍未覆盖，完整验收未通过
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

## 修复设计提案：摘要导航、按标准取证

2026-10-18 用户要求完整设计；以下为待确认方案，尚未实施。工作区检查干净。本地未找到 DeepSeek Harness 源码，本提案不修改 Session、压缩、取消或存储协议，不声称重新完成 Harness 源码对照。

### 目标与边界

Main 检查交付完整性、成果与验收标准是否一致、标准要求的关键动作是否发生。结构事实直接使用系统提交记录；成果检查按标准读取；有疑点才扩大证据范围。保留日志每段 300 字符的截断，不自动注入全部日志，不新增一次模型摘要请求，不新增通用审查框架或完成提交字段。

摘要、自检 note 是 Node 的声明和导航，不是正确性证明。现有 summary / criteria.note / resource_ids / remaining 足以表达完成报告。通用提交提示要求 note 简短说明结论及证据位置；F12.7 的 summary 仍保持原始严格 JSON，定位信息放在任务说明及 note，不向 JSON 加键。Node 没有可见 Resource 时不虚构资源 ID。

```text
[reuse] Node reads original inputs -> submit summary + checks + remaining
                                                    |
[change] Harness publishes source resources + compact evidence directory
                                                    |
                                                    v
[change] Main checks recorded fields -> selects evidence by criterion
                                                    |
                                                    v
[reuse] fetch_resource small ranges / read_node_turn for required actions
                                                    |
                                                    v
[change] enough: decide; contradiction: targeted rework; inaccessible: escalate
```

### 通用审查策略

- 先对照标准形成简短的检查目的，不要求额外文本回合或新增规划工具。
- 提交字段完整性和自检布尔值直接依据 completionSignal，不为每个结构字段再找日志佐证；satisfied=true 仍不证明业务正确。
- 成果内容优先读取已有产物，同一证据可以覆盖多个标准，不重复读取。
- 只有标准要求执行过程或结果存在疑点时才读取工作日志；工具调用成功仅证明执行，不证明计算正确。
- 每次资源读取指定小范围 start_line / max_lines；不自动从头分页到尾。只在缺失、矛盾或高影响结论尚无支撑时扩大对应范围，反馈指出具体标准与证据缺口。
- 数值正确、引用存在等实质结论需要证据；摘要不能单独支撑。抽查通过不宣称全量重算通过，完整验证由明确约定的确定性校验或专门验证工作承担。
- 不设置通用硬性两次调用或固定 token 上限，避免把复杂工作逼成盲目批准；本次夹具通过精简证据范围实现可测量的节省。

### F12.7 原始证据交接

由夹具在第一次 Node 执行之前，发布十个原始批次的 Main-owned private Resource，并生成一个同样仅 Main 可见的精简审查 Resource。Node A/B 的工具范围和原始读路径、顺序、次数保持不变，不提供可绕过长程读取的 Node 可见捷径。

精简证据文件按批次分组：短目录记录批次、原文件 Resource ID、对应精简文件行段；每组逐字保留原文件所有以 RECORD 开头的行，同时附原始行号。提取通过扫描实际文件内容完成，不使用 expected 数值生成证据；不添加计数、总和、异常总数、verified 或通过结论。目录和提取内容来自夹具，Node summary 另保留其来源。

这不是 Node 自写摘要：夹具依据任务中明确的 RECORD 规则提取全部相关原行、去掉 filler；Main 自己核对数值。原文件 Resource 仍可按原始行号读取，遇到疑点可对照；不新增生产权限或“不可修改资源”能力，本轮夹具不更新证据，验收限制禁止 Agent 改写这些资源。

定位入口在创建 Node 定义时写入简短的审查材料说明，提供精简 Resource 名称/ID与目录行段；read_node 可取得，不新增 checklist 的跨模块查询或第二份资源目录状态。夹具资源不伪装成 Node 提交的成果。

Node A：检查严格 JSON、十批条目与合计内部一致性；通过工作日志核对十次有序读取；从精简证据选一个批次核对实际 RECORD。该抽查不是全十批原文重算，全量正确性继续由夹具独立 validator 判断。

Node B：对照 summary 的十批条目复核合计；读取精简证据的批次 1 / 5 / 10（每批八条原始 RECORD），独立复算其计数、总和和异常数，并对照 final JSON；工作日志只用于确认 summary 与三批文件的规定读取。这里读取三批全部相关记录，因为该 Node 的任务本身就是验证这三批，不扩展到十批全部原文。

### 模块职责与变更范围

- src/project/profile.ts：修改审查提示，分开结构核对、成果核验和过程核对；按标准覆盖证据而非每字段另读一次，明确停止与扩读条件。
- src/tools/builtins/node/submit.ts：仅细化现有 summary / note 的描述，鼓励结论与证据定位；不改 Schema 字段、运行时校验、状态变化。
- scripts/compaction/handoff.ts：复用现有 Resource 发布路径，补齐执行前原始材料与精简证据的发布、来源记录；保留现有 Node A JSON 原样交接。若该文件超过职责/行数阈值，再按证据发布边界放入同目录 evidence.ts，不为对称新增文件。
- scripts/compaction/setup.ts、protocol.ts、入口 scripts/compaction.ts：安排先发布审查材料、后创建带定位说明的 Node；不修改数据难度与严格 JSON 输出，不向 Main 暴露 expected。
- scripts/compaction/checks.ts：保留禁用 register_resource；增加精简证据可读取、关键审查范围确实被读取、证据未被改写的检查。原始材料疑点复查合法，不把任意额外读取一律判失败。读取行为只证明取证发生，不证明模型推理正确。
- tests/project/runtime 下相关审查回归、tests/integration/compaction 下现有验收测试：只补本缺口对应的回归，不新增通用测试框架。
- 本笔记、bug-plan.md、backend-plan.md、117 与 index.md：同步设计、实际结果及关闭边界；无 frontend 改动。

错误和取消沿用现有 fetch_resource / Runtime：资源不可用、读取失败不能转换为通过；证据矛盾提出具体返工，无法取得关键证据再升级。目录随 Resource 持久化，重启状态比较包含新增资源；不新增恢复动作、重试或自动模型请求。

### 验证与完成标准

1. 离线验证逐字提取全部 RECORD、原始行号和资源映射，排除 filler 与 expected 答案泄漏；资源只对 Main 可见，Node 仍读取原始大文件。
2. 定向真实 App + 脚本 adapter 回归验证 Main 能分段 fetch 精简证据、跨重启仍可读取；结构字段不依赖日志重建。伪造摘要与原始证据矛盾时不会由系统自动批准。脚本 adapter 回归不冒称真实模型判断力证明。
3. 保留 Node JSON 严格校验、两次 pressure 压缩、暂停、原样交接、同库重启零自动请求、两 Node 正确完成及 Main 审查等原门禁；补充 Main 实际读取范围与成功/失败情况。
4. 汇总审查阶段实际资源返回字符数、模型 usage 可用值与调用数。夹具目标是 Node B 原始证据约 24 条 RECORD，而非三份 310 行文件；这是输入范围目标，不预先承诺精确 token 或节省百分比。usage 缺失不补造。
5. 代码落地后完成本机类型检查、完整测试、当前 head CI。真实 gpt-6-luna 复验另行授权，沿用最多 20 分钟、48 请求含摘要，单次运行，无自动重跑；本轮设计不启动。
6. 只有完整真实流程及本地 / CI 门禁全部通过才关闭 BUG-017 和收口 F12.7；不能用 mock 或夹具已知答案替代 Main 实际取证。

确认实施前不修改上述代码；下一步为用户审阅并确认本设计。

## 2026-10-18 已授权实施

用户补充“并非每次会话都有资源”，确认后授权修复。以上提案保留为历史；实际实现将依据分为系统提交事实、提交答案本身、可观察操作/当前状态、Resource 内容四类。无资源不是缺陷，不要求为审查创建文件。summary / note / submit_review.reason 描述及 Main 系统规则一并明确这一点；业务事实仍需要适当依据，摘要不自动等于正确性证明。

### 实际模块与取舍

- src/project/profile.ts：按标准选择依据，同一证据可复用；小范围读取、疑点才扩读、充分即停止。规则由模型执行，不新增强制审查规划回合或硬性两次读取上限。
- src/tools/builtins/node/submit.ts、project/review.ts：细化现有字段说明，支持直接答案、操作/状态及资源范围；不修改 Schema、状态机、权限或提交校验。
- scripts/compaction/evidence.ts：执行前读取实际原文件，逐字提取所有 RECORD 行并保留原行号，发布十个私有原始资源与一个私有精简资源；目录提供批次对应行段和原资源 ID。只删 filler，不算答案，不使用 expected。
- setup.ts 给两个 Node 的原定义追加简短 Main 审查定位，Node 仍只能按原协议读原文件。材料不冒充 Node 成果；提交 resource_ids 仍为空。Main 可读目录后按目的读取，必要时展开原始行段。
- evidence.ts 的 assertReviewEvidence 检查实际成功 fetch 返回的行，而非只看请求参数：A 至少一个完整批次相关记录，B 为 1 / 5 / 10 三批；允许精简及原始资源的对应行组合覆盖，不强制走单一读取路径。检查资源仍存在、版本 1、private，记录成功读取次数、实际返回字符数与可用的模型 usage。usage 仅覆盖 reportedSteps，不伪造缺失计量。
- scripts/compaction.ts 串行接入发布、证据落盘与最终审计。入口恰好 300 行，保留单一生命周期编排，证据发布与审计独立在 evidence.ts，没有新增第二个状态机。
- 重启继续复用既有完整 domain 状态比较，无新恢复请求；日志截断不变，未新增模型摘要调用、通用证据协议、前端改动或压缩算法修改。
- 修复来自 App 回归发现的既有审查关联错误，另记 [BUG-018](122-bugfix-bug-018-review-turn.md)，不冒称 BUG-017 的原始根因。

### 当前验证

- Windows + Node 24.19.0，System32 在 PATH 最前。定向 3 文件 / 7 项通过，随后补充无资源实际 Mailbox 操作场景进入全量验证。
- 零模型请求 preflight 通过，原始数据仍 62905 估算 token；Node 基线 3414，Main 基线初版 5965、精简后 5714，均在现有 6000 门槛内。证据：C:/Users/likeW/AppData/Local/Temp/navo-f127-evidence-1792316758590/。
- App 回归验证资源只对 Main 可见、80 行逐字提取与原始行号、同库重启零请求、Main 按指定范围 fetch、缺行拒绝；Node B 三次读取返回合计少于 3000 字符。mock 只证明接线和校验，不证明真实模型判断效果或线上 token 节省比例。
- 无资源回归覆盖直接答案通过、空泛自述返工，以及实际发送 Mailbox 通知后查询当前记录。决定由 scripted adapter 指定，不把它称为真实模型自动选择的结果。
- 本机完整检查、当前代码 head CI 与推送结果在下方追加。真实 gpt-6-luna 复验未启动，BUG-017 保持未勾选，PR #79 不合并。

### 下一步

完成本机与 CI 后单独授权真实复验。用户本轮仅授权修复，不自动消耗模型请求；未落实的验收仍是完整真实两 Node / Main 完成及实际 token 用量观察。

### 本机完整检查收口

修复分支 fix/bug-017-review-evidence 从最新 origin/master 建立，再串行快进纳入尚未合入的 F12.7 分支，避免把修复建立在缺失验收代码的基线上；完成后串行整合回阶段草稿 PR #79。

命令：node node_modules/typescript/bin/tsc --noEmit；node node_modules/vitest/vitest.mjs run --maxWorkers=4。最终类型检查通过，130 文件 / 793 项通过，49.46s。首次全量 792 通过 / 1 失败，证据为小窗口 Main 第二次审查 context-compaction-no-progress；将新增审查规则和重复的来源说明压缩后，原压力测试恢复，通过完整复跑，未调整阈值、fixture 或取消压缩门禁。最终 preflight Main 基线降至 5714，原始数据仍为 62905，模型请求为 0。

差异检查通过；工作日志截断、严格 JSON、Node 读取次数及全部原阶段断言保留。代码与文档将推送至草稿 PR #79，当前 head CI 结果另行核对。完成交付需附模块导读；真实复验仍待用户另行授权。

### 推送与 CI

修复提交 dd74d0c 已串行快进整合并推送 phase12-f12.7-compaction-acceptance，工作区干净，master 与 origin/master 一致。该代码 head 的 [CI run 39116730431](https://github.com/likeWind221/Navo/actions/runs/39116730431) 成功（typecheck / test）。PR #79 描述已更新，保持草稿、不合并；BUG-017 待授权真实复验，BUG-018 待阶段合入，均保持未勾选。本段是检查已通过代码的记录，后续仅文档收口提交仍核对其自身 CI。

## 2026-10-18 17:55 授权真实复验：A 按精简证据通过，B 遇传输失败

用户明确授权一次真实复验，Codex 直接启动，无 worker、无自动重跑。head 9f3532f 的 [CI 39117064298](https://github.com/likeWind221/Navo/actions/runs/39117064298) 已通过；沿用 gpt-6-luna、32768 阈值、20 分钟 / 48 请求含摘要、maxModelRetries=0。

- 本地时间约 17:55:40–17:58:43；182862ms，24 次请求（21 任务 / 3 摘要），第 24 次失败，runner exitCode=1。没有达到时间或次数上限。
- 证据目录：C:/Users/likeW/AppData/Local/Temp/navo-f127-luna-20261018-175539/，含失败记录与只读 review-diagnostic.json；日志为同路径后缀 -run.log。
- 保留数据库：C:/Users/likeW/AppData/Local/Temp/navo-f127-storage-OYq2aE/navo.db；Workspace：C:/Users/likeW/AppData/Local/Temp/navo-f127-workspace-zbIpCP。
- Project 39782c4f-5d5a-4416-b924-7506681d7393；Main Session c74ee6cf-229e-4156-9193-c7943fda48fa；A Session bd790b10-1e62-4fc1-a944-0805e88999ea；B Session 02f381db-872d-43e6-855a-5bb519cd50d1。

### 实际通过的部分

Node A 顺序读取十个原文件一次，提交原始严格 JSON，通过独立 validateSummary；80 条、3958 总和、20 异常。三次 pressure 压缩完成并被后续任务复用：37070→17586、39258→18730、33181→11395。审查前暂停、原样 JSON 交接、同库重启完整状态严格比较通过；请求数 14→14，无自动恢复请求。

Main 实际用六次请求完成 A 审查，调用 read_node、fetch_resource 目录（start_line=1/max_lines=12）、fetch_resource 批次 1（13/8）、read_node_turn 第 1 页及 submit_review complete；无 rework、无注册新资源。资源两次读取返回 1041+555=1596 字符；批次八条 RECORD 全部返回，Main 在理由中独立核对 434 与两个异常 ID。日志返回 4604 字符，用于核对十次读取；没有读取原始大文件或完整执行历史。

Main 的六次 assistant-message 均含供应方 usage，累计报告 inputTokens=48481、outputTokens=523；这是多次请求的累计报告，不能当作唯一证据大小、实际账单或与旧版匹配对照的节省比例。精简证据按目的读取已在 A 上真实出现，B 尚未覆盖。

### 停止原因与边界

Node B 成功读取 out/summary.json、data/batch-01.txt、data/batch-05.txt 后，第四次模型请求（全局第 24 次）失败。Session error.source=llm，failure.code=TRANSPORT，message="OpenAI Responses request could not be reached."；未调用读取 batch-10，也未提交 final JSON，更未进入 Main 对 B 的审查。B 回到 idle，A 保持 completing；Host dispose 成功，无错误。

确认是适配器报告的传输失败，现有持久化证据无法进一步区分本机网络、代理或上游链路原因；不归因为 Node 算错、压缩失败或 Main 再次拒绝证据。不因此登记一个未经定位的产品缺陷，也不新增重试绕过协议。

本轮 BUG-017 只有 A 审查路径取得真实正向证据，原 B 审查缺口的完整复验仍未完成；BUG-014 / 015 / 016 / 017 保持未勾选，BUG-018 的最终成功检查亦未走到。F12.7 仍为进行中，PR #79 保持草稿、不合并。诊断仅用只读 SQLite，未重开 App、未修复或继续运行现场，未增加模型请求。

后续若排查请求链路或重新运行，需按用户新的授权执行；本轮不自动重试。此次仅补充真实证据与状态文档，未修改代码，不重复运行已经通过的本机完整测试。

## 2026-10-18 18:07 授权重跑：A 执行中再次 TRANSPORT

用户判断可能为网络波动，并明确授权再重跑一次。沿用原模型、阈值、20 分钟 / 48 请求及零模型重试协议，以 head ecadc6e 启动全新 Workspace / 数据库；前一现场未恢复或覆盖。

- 约 18:07:24–18:08:48，84225ms；11 次请求（9 任务 / 2 摘要）。第 11 次任务请求失败，runner exitCode=1；未耗尽上限，无自动重跑。
- A 顺序成功读取批次 1–8，两次 pressure 压缩完成：37070→17579、37787→17664；之后模型任务请求报 source=llm、code=TRANSPORT、message="OpenAI Responses request could not be reached."。
- A 未提交，未进入审查前暂停 / JSON 交接 / 重启。Main Session 事件数为 0，B 未解锁；本轮未增加 BUG-017 审查路径的验收证据，也不能据此判定修复复发。
- Host 正常 dispose；诊断仅以只读 SQLite 核对批次与错误，零新增模型请求。原始现场、failure.json、runner-exit.json 与 transport-diagnostic.json 已保留。
- 证据目录 C:/Users/likeW/AppData/Local/Temp/navo-f127-luna-20261018-180723/；日志为该路径后缀 -run.log。
- 数据库 C:/Users/likeW/AppData/Local/Temp/navo-f127-storage-aWNxi7/navo.db；Workspace C:/Users/likeW/AppData/Local/Temp/navo-f127-workspace-fFLQSU。
- A Session 4ae81d10-135e-4e07-ac86-a6a7aa2e9590；Main Session 561de2d3-e00b-4197-a780-e759e2b18909。

连续两轮复验在不同执行位置遇同类传输错误。现有记录只证明请求链路失败，仍不足以定位本机网络、代理或上游；不将“网络波动”写成已确认根因，不擅自增加重试、修改网络配置或继续付费尝试。建议下一步先在新的授权范围内排查请求链路，再考虑完整复验。

前轮 A 的精简证据审查成功仍保留；B 审查与完整两 Node / Main 验收均未完成，BUG-017 及 F12.7 保持进行中，PR #79 不合并。本轮仅更新结果文档，不改代码、不重复本机完整测试。
