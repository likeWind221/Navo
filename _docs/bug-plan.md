# Bug 跟踪与修复计划

此文档是 Bug 修复状态的单一事实源；功能阶段继续在 [后端计划](backend-plan.md) 和 [前端计划](frontend-plan.md) 管理。勾选表示修复验收完成，合并代码不等于修复 Bug。维护规则见 [AGENTS.md](../AGENTS.md)。

## 当前状态

- [ ] BUG-016：Main 已收到归一化自检字段，却要求从截断日志核验原始 criteria，合法提交两次返工后升级；完整真实验收失败，仅排查、未修复。见 [120](120-bugfix-bug-016-review-submission.md)。

- [ ] BUG-015：双事件观察器已修复，真实审查前暂停、交接后重启通过；完整完成被 BUG-016 阻断，原关闭条件仍未全部满足。见 [119](119-bugfix-bug-015-compaction-pause.md)。

- [ ] BUG-014：原未开放 write 错配已修订，真实 JSON 交接与重启通过；完整完成被 BUG-016 阻断，保持未勾选。见 [118](118-bugfix-bug-014-compaction-acceptance.md)。

- [x] BUG-013：补齐 F11.3 四个错误提示并修正测试命名；前端完整检查、139 测试、Electron bridge 实际调用、根目录 695 测试与代码 head CI 通过（PR #71，收口提交仍执行当前 head CI 门禁）。见 [107](107-bugfix-bug-013-autorun-desktop.md)。

- [x] BUG-012：F11.4 真实验收脚本未调用入口且未提供下游所需材料；已修正，本机完整检查、gpt-6-sol 双节点真实完成及代码 head CI 通过（PR #70，收口提交仍遵循当前 head CI 门禁）。笔记：[106](106-bugfix-bug-012-autorun-acceptance.md)。

未关闭：BUG-002、BUG-007、BUG-010、BUG-014、BUG-015、BUG-016。BUG-002 等待复现，BUG-007 经用户决定搁置，BUG-010 修复已合入、待本机 Qwen 对照与 F5.4 Electron 真实验收；BUG-014 / BUG-015 的交接与暂停已真实验证，但完整完成被 BUG-016 审查误读阻断，新问题仅排查、未修复。

- [x] BUG-001：Node 续接时未读取已共享的新验证资源（已修复：续接资源变化通知 + Resource ID 语义）
- [ ] BUG-002：验证节点发布文件时出现来源不可用错误（诊断已补齐，未复现；2026-10-07 用户决定保持未关闭，等待复现后依证据定性）
- [x] BUG-003：Agent 文字状态报告与当前领域状态不一致（已修复：陈述前读取或声明未核实）
- [x] BUG-004：真实验收的失败现场留存不足（已修复：逐回合证据落盘）
- [x] BUG-005：未知工具名的报错被模型误读为权限拦截（已修复：先查注册表再判白名单，未知名字返回 unknown-tool 与可调用列表）
- [x] BUG-006：真实模型频繁产生格式错误的工具名（已处理：定位为模型输出；改名 `create_roadmap` 降低触发，`unknown-tool` 反馈保证同回合恢复）
- [ ] BUG-007：thinking 推理耗尽输出 token 上限导致回合 blocked（2026-10-09 登记，未排查；同日用户决定搁置：大概率是 qwen3.8-27b 思考过长的模型特性）
- [x] BUG-008：shell 取消在 CI 上偶发挂起至 `close` 超时（2026-10-11 登记；2026-10-12 已修复：根因为 taskkill 枚举进程树时漏杀 pwsh 正在创建的子进程，改为 shell 先进入 `KILL_ON_JOB_CLOSE` 作业再执行命令，并保留 1 秒排空兜底）
- [x] BUG-009：Responses 工具 namespace 缺少必填 description，真实订阅请求返回 HTTP 400（M1.4 已补齐；真实文本/read、本机完整验证与当前 head CI 通过，PR #54 已合入）。笔记：[92](92-bugfix-bug-009-namespace.md)。
- [ ] BUG-010：gpt-6-luna 为 `create_roadmap` 生成跨 Node 分支字段，运行时连续拒绝，真实 Project 无法创建 Roadmap（2026-10-15 已删除控制节点并把 Roadmap 修改工具按动作拆分；gpt-6-luna / gpt-6-sol 真实复验规划与修改计划均通过，Qwen 对照与 F5.4 Electron 验收待本机）。笔记：[95](95-bugfix-bug-010-roadmap-schema.md)。
- [x] BUG-011：重启后节点列表从创建顺序变为 ID 顺序（2026-10-15 F10.5 发现；同日修复：存储按每个 owner 首条事件的写入顺序回放，资源列表经核实本不受影响）。笔记：[99](99-bugfix-bug-011-restart-order.md)。

## Bug 明细表

优先级：P1 阻断目标闭环，P2 影响诊断或报告可信度。优先级不代表已确认生产代码缺陷。

| ID | 优先级 / 所属端 | 现象与影响 | 证据与归因状态 | 关闭条件 | 笔记 |
|---|---|---|---|---|---|
| BUG-016 | P1 / 后端审查 | 合法提交已含自检索引与布尔值，Main 仍因截断日志不可核验而两次返工后升级，阻断 F12.7 | 三次原始 criteria 正确，清单也含归一化自检信息；参数日志固定裁到 300 字符，模型未区分已校验提交结构与任务成果自述。现象已确认，信任语义歧义与模型误读的交互待修订验证；仅排查 | 明确结构事实与任务证据边界，定向回归保留内容独立核验，不强制 complete；本机完整检查、真实两 Node / Main 完成及当前 head CI 通过 | [120：排查笔记](120-bugfix-bug-016-review-submission.md) |
| BUG-015 | P1 / 后端验收 | Node 已提交，但验收观察器未在 Main Review 前请求暂停，无法按协议交接与重启 | Node.endWork 在 Session turn-ended 后发生；只监听 session/event 无法观察最终 submitted；Luna 正确 JSON、两次压缩与提前 Main escalate 现场已保存 | 旧代码失败的真实 App 回归通过；监听 Node 提交后正确暂停、释放订阅；本机完整检查与当前 PR head CI 通过，真实交接/重启/完成复验通过 | [119：排查修复笔记](119-bugfix-bug-015-compaction-pause.md) |
| BUG-014 | P1 / 后端验收 | F12.7 要求 Node 写出 JSON，但 Node 未获 write，无法注册产物及完成 Project | 实际任务请求工具列表及 Node Profile 均无 write；三次 register_resource 因源文件 ENOENT 失败。已确认验收协议错配，不归因为压缩失败；现已改为原始 JSON 提交与脚本交接，完整真实验收未通过 | 验收所需能力与实际公开工具一致，预检查可拦截错配；修订协议后本机完整验证、真实多次压缩 / 重启 / 两 Node 完成与 PR head CI 通过 | [118：排查笔记](118-bugfix-bug-014-compaction-acceptance.md) |
| BUG-013 | P1 / 前端 | F11.3 前端类型检查失败，默认测试未运行 AutoRun handler 场景 | TS2366 已复现；四个错误码缺少提示分支，`.test.ts` 不匹配 `.spec.ts` 发现规则均已确认 | 前端完整 typecheck/test/build 通过，四项测试被发现，真实 Electron bridge 验证通过；完整本地检查及当前 PR head CI 通过 | [107](107-bugfix-bug-013-autorun-desktop.md) |
| BUG-012 | P2 / 后端验收 | AutoRun 真实脚本空退出，补齐入口后空材料导致下游等待，不能证明完成链路 | 入口缺失、空 Workspace 与无共享 Resource 均已确认；原真实现场已保留 | 入口真实执行并在失败时非零退出；有效输入下两个 Node 经 Main 判完成；本机检查与当前 head CI 通过 | [106](106-bugfix-bug-012-autorun-acceptance.md) |
| BUG-001 | P1 / 后端 | synthesis 续接仍读取旧 evidence，报告缺少 validation，无法产出最终推荐 | 首次有效运行第 8 回合；Store 权限检查通过，但未留存该回合请求快照。上下文传递遗漏、模型漏读或旧历史干扰均待确认。2026-10-07 证据确认：新 Resource 已在续接提示中，失败为模型被历史“缺失”结论压过并把名称当 ID；修复后续接 8/8 成功（run 6-13），Resource 引用加固后工具调用零失败 | 留存该回合模型输入和调用结果，定位并处理原因；真实模型读取新 Resource 并形成有依据的结论，同时保持原 Session 和 Human Gate；笔记记录完整复验 | [发现记录](66-devlog-f9.8-longterm-acceptance.md)、[登记与排查边界](67-devlog-bug-tracking.md)、[修复笔记](68-bugfix-bug-001-004-longterm.md) |
| BUG-002 | P1 / 后端 | validation 注册文件时出现 `Resource source file is unavailable`；模型随后恢复，但严格验收在第 6 回合停止 | 第二次有效运行；未留存失败调用的 path 和底层 I/O 原因。该消息可来自 realpath/stat 的 I/O 失败，不能据此断言一定是模型猜错文件名。2026-10-07：错误已携带 path 与 errno，验收改为“不得有未恢复错误”；run 2-13 均以正确路径注册成功，原错误未复现，原因仍未证实 | 捕获实际参数及失败原因，明确输入文件交接与工具错误恢复的预期；处理已证实问题，真实场景能正确发布/读取所需文件；明确可恢复工具错误的验收标准，不能仅删断言以通过 | [发现记录](66-devlog-f9.8-longterm-acceptance.md)、[登记与排查边界](67-devlog-bug-tracking.md)、[修复笔记](68-bugfix-bug-001-004-longterm.md) |
| BUG-003 | P2 / 后端 | Main 在 synthesis 实际 idle 时仍报告 locked，误导用户下一步操作 | 首次有效运行的交接回复；属于可观察的文本与事实不一致，具体提示、历史或查询使用原因待确认。回合内 working 与回合后 idle 的正常转换不算此问题。2026-10-07：确认原因是人工确认发生在 Main 对话外且提示无重读规则；修复后状态探针 10/10 本回合读取并答 idle，Main 另收节点状态变化提醒 | 关键状态报告基于当前可信事实；以实际状态转换场景验证报告一致，无法确认时表达未知；保留真实复验文本与对应快照 | [发现记录](66-devlog-f9.8-longterm-acceptance.md)、[登记与排查边界](67-devlog-bug-tracking.md)、[修复笔记](68-bugfix-bug-001-004-longterm.md) |
| BUG-004 | P2 / 后端验收脚本 | 失败输出仅含工具名称与错误摘要，缺少具体参数和关联上下文；应用释放后不能还原现场，妨碍 BUG-001/002 定位 | `scripts/longterm.ts` 已增加请求资源 ID 摘要，但首次失败未有此摘要；未持久化失败所需事件。此诊断缺口已确认。2026-10-07：逐回合证据与 failure.json 已用于定位 BUG-001 | 失败时留下足以关联 Turn、输入资源元数据、工具参数、结果和状态的脱敏证据；复现后可区分上下文、模型选择与 I/O 错误，不泄露凭据或记录无关数据 | [登记与排查边界](67-devlog-bug-tracking.md)、[修复笔记](68-bugfix-bug-001-004-longterm.md) |
| BUG-005 | P2 / 后端 | 模型输出不存在的工具名时，ToolService 返回 “Tool '…' is not allowed for this Turn.”，模型把它理解为平台权限拦截而放弃操作；F9.10 五场景第 5、6 轮因此规划未落盘 | F9.10 真实模型验收（`scripts/goal.ts`，qwen3.8-27b）。报错文案未区分“工具不存在 / 名称格式错误”与“本回合未授权”属已观察事实；文案是否为主因、其他模型是否同样误读待确认。当前由 Main 提示词规则 2 规避。2026-10-08 确认根因：ToolService 先判白名单后查注册表，未注册名字一律落入 `tool-not-allowed`；修复后去掉规则 2 真实复验 5 轮，3 次残缺名均收到 `Unknown tool` 并同回合恢复 | 未知或格式错误的工具名与真正的权限拒绝返回可区分的错误，提示模型修正重试；真实模型复验在不依赖提示词规避的情况下能自行恢复；保留复验记录 | [74：F9.10 开发记录](74-devlog-f9.10-goal-confirm.md)、[修复笔记](76-bugfix-bug-005-unknown-tool.md) |
| BUG-006 | P2 / 后端 | 真实模型多次输出形如 `write_\n<parameter=...` 的残缺工具名，导致调用失败，需模型重试；F9.10 最终版两轮出现 4 次 | F9.10 五场景与 F9.10 首轮记录均有出现；BUG-005 复验又见 `write_` + 换行 + `oadmap` 形态（[76](76-bugfix-bug-005-unknown-tool.md)）。2026-10-09 已定位：原始 SSE 显示 vLLM 单个 delta 整段下发残缺名，排除适配层拼接；非流式 logprobs 显示模型在 `write_` 后以 0.65–1.00 概率生成换行符 `
| BUG-007 | P2 / 后端 | 开启 thinking 时，模型在单步内推理约 3.1 万字符，耗尽 8192 输出 token，没有调用工具也没有回答，回合以 `max-tokens` 结束为 blocked；用户已同意的规划没有执行 | BUG-006 复验 goal 第 2 轮 `extract-goal` 第 2 回合（证据为本机 scratchpad 的 `probe/after/goal-2/extract-goal-2.json` 与对应原始 SSE）。仅出现 1 次；推理过长的诱因、上限配置是否合理、blocked 后的恢复路径均未排查。2026-10-09 用户决定搁置：判断大概率是 `qwen3.8-27b` 思考过长的模型特性，暂不排查；更换模型或再次出现时重新评估 | 明确 thinking 模式下的输出预算与超限处理；真实场景中不因推理耗尽而丢失用户已同意的操作，或能给出可恢复的提示；保留复验记录 | [77：BUG-006 笔记](77-bugfix-bug-006-malformed-tool-name.md) |
| BUG-008 | P2 / 后端 | Windows 上取消或超时正在运行的 shell 命令后，`runShellCommand` 偶发收不到子进程 `close`，CI 测试等满 5 秒超时；生产中回合会卡到残留进程自行退出，且被取消的命令在后台继续运行 | PR #43 的 CI 失败 2/3 次；2026-10-11 带诊断的 CI 运行未复现。2026-10-12 本机冷启动全量测试 15 轮 1 次挂起，现场：taskkill 返回 0、shell 已 exit、测试启动的 node 存活且父进程已死。已证实根因：`taskkill /T` 枚举进程树时漏杀 pwsh 正在创建的子进程（pwsh 7 启动后 200ms 结束 7–9/10 漏杀，5.1 为 0/10）。修复：shell 先进入 `KILL_ON_JOB_CLOSE` 作业再执行命令（失败退回原行为），`exit` 后 1 秒排空兜底；本机漏杀 0/10，冷启动多轮全量测试 0 挂起、0 残留 | 采集失败现场并确认根因；修复或证明不属于生产缺陷；修复后在 CI 上连续多轮完整套件无挂起并保留记录 | [排查与修复笔记](80-bugfix-bug-008-shell-cancel.md) |
| BUG-009 | P1 / 后端 | 真实订阅请求因工具 namespace 缺少 description 返回 HTTP 400 | gpt-6-luna 返回 missing_required_parameter；补齐后文本及 read 续接通过，根因已确认 | 真实文本/read、协议回归、本机完整检查和当前 head CI 通过 | [92：修复笔记](92-bugfix-bug-009-namespace.md) |
| BUG-010 | P1 / 后端 | gpt-6-luna 在目标确认后无法创建 Roadmap，阻断真实 Project 规划与 F5.4 收口 | F5.4 两个独立 Project 均复现：模型为 control 节点发送 `goal` / `done_when`，也曾为 work 节点发送 `control`；运行时按互斥联合拒绝。直接失败点已确认：工具向模型公布的扁平 Schema 允许这些字段，条件约束只写在描述里 | 工具 Schema 与运行时约束一致；非法跨分支字段仍被拒绝；后端目标确认真实验收和 F5.4 预填/空目标 Electron 真实验收均能创建 Roadmap | [95：排查与修复笔记](95-bugfix-bug-010-roadmap-schema.md) |
| BUG-011 | P2 / 后端 | 重启后 `getByProject` / `listByProject` 的顺序改变，资源列表 RPC、Main 项目事实、节点可见资源和复盘清单的顺序随之改变；数据不受影响 | F10.5 场景观察到节点顺序改变；已证实恢复时按 `ORDER BY owner_id, seq` 读取，Store 按读取顺序插入 `Map`。UI 上的影响根据代码推断，未实际观察。2026-10-15 已修复：按 owner 首条事件 rowid 回放；资源列表经核实本不受影响 | 重启前后上述列表及依赖它们的 RPC、模型上下文顺序一致；有重启顺序回归测试；F10.5 测试改回严格比较 | [99：排查与修复笔记](99-bugfix-bug-011-restart-order.md) |

## 处理时间线

2026-09-22：登记 4 项未关闭问题，尚未实施生产修复。用户明确要求将已发现问题转入此表后先合并 F9.8 阶段成果；本次允许带已知真实验收失败合并，不改变后续验证门禁，也不声称真实模型闭环已通过。阶段交付见 [PR #30](https://github.com/likeWind221/Navo/pull/30)。

2026-10-07：分支 `fix/bug-001-004-longterm` 完成排查与修复，本机共 13 次真实运行：加入续接变化通知后，续接 8/8 成功；加入名称解析与 resource_id 枚举后，Resource 工具调用零失败；随后把变化通知重构为通用 system-reminder，并推送 Main 节点状态变化。BUG-001、003、004 达到关闭条件；BUG-002 的诊断能力与验收口径已落地，但原错误未复现，保持未勾选。代码以 PR 合并为准，详见 [68：修复笔记](68-bugfix-bug-001-004-longterm.md)。

2026-10-08：F9.10 真实模型验收中发现 BUG-005、BUG-006，当前仅靠 Main 提示词“同意后失败调用修正重试”规避，未修改内核或适配层。证据见 [74：F9.10 开发记录](74-devlog-f9.10-goal-confirm.md)。

2026-10-08：分支 `fix/bug-005-unknown-tool` 修复 BUG-005：未注册名字不再被归为权限拒绝。去掉提示词规则 2 后真实复验 5 轮 40 回合全部通过，3 次残缺工具名均在同回合恢复；规则 2 作为冗余防线保留。详见 [76：修复笔记](76-bugfix-bug-005-unknown-tool.md)。

2026-10-09：BUG-006 完成根因定位（仅排查，未修复）：残缺名由模型在 `write_` 后生成换行产生，vLLM tool parser 不校验函数名、原样返回，适配层未参与；温度 0 仍稳定复现，将工具名改为 `create_roadmap` 后对照实验消除。详见 [77：排查笔记](77-bugfix-bug-006-malformed-tool-name.md)。

2026-10-09：分支 `fix/bug-006-roadmap-rename` 将 `write_roadmap` 改名为 `create_roadmap`。受控对照中残缺名从 6/6 降到 0/6；全流程 5 轮 goal 加 1 轮 longterm 仅出现 1 次 `create_` 残缺名，且同回合恢复。BUG-006 按“模型行为 + 明确恢复策略”关闭。复验中新发现 BUG-007。

2026-10-11：PR #43（F10.1a）的 CI 前两次运行中，shell 取消测试挂起至 5 秒超时，登记为 BUG-008。诊断 PR #44、#45 在 CI 上共跑约 6 遍完整套件加 21 次专项取消，均未复现；正常取消约 0.3 秒，taskkill 每次都成功。不采用“把两个 shell 测试文件改成先后跑”：取证显示它们并发并不是触发条件。详见 [80：排查笔记](80-bugfix-bug-008-shell-cancel.md)。

2026-10-12：BUG-008 在本机冷启动全量测试中复现（15 轮 1 次），现场证实 `taskkill /T` 漏杀 pwsh 正在创建的子进程（pwsh 7 启动后 200ms 结束时 7–9 成漏杀）。修复为 shell 先把自己放进 `KILL_ON_JOB_CLOSE` 作业再执行命令，并在 `exit` 后设 1 秒排空兜底；行为变化：命令结束时其后台进程一并结束。本机冷启动多轮全量测试 0 挂起、0 残留，CI 结果见笔记。详见 [80：修复笔记](80-bugfix-bug-008-shell-cancel.md)。

2026-10-14：F5.4 真实 Electron 验收发现 BUG-010。`gpt-6-luna` 在预填目标和目标留空两条路径中均完成目标确认，但 `create_roadmap` 多次携带与 Node kind 不匹配的条件字段并被运行时拒绝；目标写入、follow、失败展示、取消和布局已通过，Roadmap 创建未通过。详见 [95：排查与修复笔记](95-bugfix-bug-010-roadmap-schema.md)。

2026-10-15：在 `fix/bug-010-roadmap-schema` 尝试把 `create_roadmap` 拆为 `work_nodes` / `checkpoints` 两个扁平数组。Qwen 对照首调合法率从 14/15 降到 12/15：模型在两个数组参数之间写出坏的 JSON。用户决定整体回退，未合入生产代码；gpt-6-luna 因额度用尽未复验。BUG-010 保持未修复，详见 [95](95-bugfix-bug-010-roadmap-schema.md)。

2026-10-15：F10.5 离线长程场景在重启前后比较节点列表时发现 BUG-011：恢复时按 `owner_id` 读取事件，导致列表顺序从创建顺序变为 UUID 顺序，数据本身不变。F10.5 测试暂时按 ID 排序后比较，详见 [99](99-bugfix-bug-011-restart-order.md)。

2026-10-15：F10.5 真实验收（`gpt-6-sol`）复现 BUG-010：用户同意规划后，Main 的 15 次 `create_roadmap` 都为 work 节点附带 `control: "checkpoint"`，全部被拒，回合在 16 步上限处 blocked，F10.5 真实验收停在规划阶段。详见 [95](95-bugfix-bug-010-roadmap-schema.md)。

2026-10-15：分支 `fix/bug-011-restart-order` 修复 BUG-011：事件历史统一按每个 owner 首条事件的 rowid 排列、owner 内按 `seq` 回放，Node 与 Session 列表重启前后保持创建顺序；资源事件以 Project 为 owner，经核实本来就稳定。新增存储层与 NodeStore 重启顺序回归测试，F10.5 恢复严格比较；本机 typecheck 与 667 项测试通过。详见 [99](99-bugfix-bug-011-restart-order.md)。

2026-10-15：分支 `fix/bug-010-remove-control-node` 按用户决定删除控制节点（start / end / checkpoint）：每个 Roadmap Node 都是带目标与完成标准的工作节点，`create_roadmap` / `modify_roadmap` 只接受这一种字段全部必填的形状，`NodeV1` 去掉 `kind` / `controlPurpose`；旧数据库中的控制节点在恢复时丢弃并把前后节点直接相连。离线验证通过，真实模型（Qwen 基线、gpt-6-luna、gpt-6-sol）尚未复验，因此保持未勾选。详见 [95](95-bugfix-bug-010-roadmap-schema.md)。

2026-10-15：BUG-010 真实模型复验（云端容器）：gpt-6-luna `scripts/goal.ts` 5 个场景全部通过，3 次 `create_roadmap` 首调均合法；gpt-6-sol 在 F10.5 场景中首次 `create_roadmap` 即成功。F10.5 后续回合因 Node 拒绝提交未满足标准的作业而中断，与本 Bug 无关。Qwen 对照与 F5.4 Electron 真实验收仍待本机完成，保持未勾选。详见 [95](95-bugfix-bug-010-roadmap-schema.md)。

2026-10-15：BUG-010 同根因扩展到 `modify_roadmap`：该工具用 `action` 承载 6 个动作并公布扁平 Schema，非当前动作的字段只在运行时拒绝；gpt-6-sol 在 F10.5 第 6 回合为 `edit_node` 填满所有字段的占位值，连续 13 次被拒。已拆为 `add_node`、`edit_node`、`remove_node`、`set_dependency`、`reorder_nodes` 五个参数全部必填的工具；复验中 sol 首次 `edit_node` 即成功。同时修正 Node 拒绝 Human 明确提交请求的问题。仍待本机 Qwen 对照与 F5.4 Electron 验收，保持未勾选。详见 [95](95-bugfix-bug-010-roadmap-schema.md)。

## 修复记录规则

首次修复或进一步实质排查时创建下一可用编号的 `NN-bugfix-bug-NNN-<短名>.md`，并在上表与索引建立链接；同一问题追加至已有笔记。每项写清复现、根因证据、改动、实际验证、剩余边界和 PR/提交。完成并通过该项关闭条件后才将对应任务改为 `[x]`。

已按 BUG-004 → BUG-001/002 → BUG-003 顺序处理。剩余 BUG-002：2026-10-07 用户决定保持未关闭，等待复现后依证据定性。

## 已识别但不列为已确认 Bug 的边界

- `synthesis` 是测试目标为“综合结论”的普通工作节点，不是特殊 Agent 类型。
- Resource ACL 控制已发布资源的读取；Project Workspace 是共享文件空间。能从用户 Workspace 重新发布文件不直接证明 ACL 被绕过，也不据此擅自增加节点文件白名单。
- “每回合不得发生任何工具错误”是当前真实验收脚本的严格判据，不等同于运行时不允许模型恢复；其业务适用性在 BUG-002 中一起明确。
