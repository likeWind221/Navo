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
