# F12.7 长程压缩验收

> 日期：2026-10-18
> 状态：🔄 修复后完整 130 文件 / 793 项、类型检查与代码 CI 通过；最新 Luna 24 请求完成三次压缩、暂停交接与重启，Main 按精简证据通过 A，B 执行中遇 TRANSPORT，未提交也未进入审查；完整真实验收未通过，详见 [121](121-bugfix-bug-017-review-evidence.md)

## 做了什么

- Codex 负责验收设计、结果审核、共享文档与 PR 收口；两次独立 Claude Code CLI 会话分别实现离线集成测试和真实模型验收脚本，写入范围互斥。
- 不修改生产逻辑、桌面 UI、公共 RPC 或依赖；若发现生产缺陷，另按 Bug 流程处理，不弱化断言。
- Claude Code 已交付离线场景与真实脚本，经 Codex 审核修正请求分类、事务现场、重启比较与证据计数；真实验收未通过，不标记阶段完成。

## 关键决策

- 离线使用真实 App / SQLite / AutoRun / Main / Node，只控制模型响应。覆盖同一 Session 多次压缩、Main 压缩后审查、超窗恢复、不可恢复失败暂停、检查点后的暂停与重启，以及两类未闭合压缩事务的恢复。
- 中断事务使用持久日志前缀现场，不给生产代码增加故障钩子，也不宣称真实硬崩溃验收。
- 真实模型使用 `gpt-6-sol`，虚构批次材料与独立计算的标准答案，两个依赖 Node 及 Main Review；要求同一 Node Session 至少两次成功 pressure 压缩。第二次压缩后请求暂停，等待回合结束再重开同一数据库，验证不自动运行，显式 start 后最终完成。
- `autoCompactLimit=32768`，不填写虚构的 provider contextWindow；本地低压缩阈值不等于服务端真实小窗口。真实任务不注入超窗；超窗恢复由离线测试证明。
- 真实运行上限 20 分钟、48 次模型请求（包括摘要）、每 Turn 16 Step、模型重试 0；失败或未达到两次压缩均不通过，不运行中调参或追加材料凑结果。
- 预计实现与离线验证 1–2 小时、真实运行 10–20 分钟，不占本地 GPU，消耗订阅额度；用户已授权按此实施。

### Harness 对照

方案前只读核对 commit `d743267388641bc76f17c45ce8b4c231aed1d32c` 的 `packages/compaction/compaction-basic/src/region.ts` 与 `index.ts`。验收采用工具配对安全边界、started / checkpoint / ended 事务顺序、未闭合事务可检测，以及有 surface 替换进展才恢复超窗请求的原则。Navo 保持已确认的差异：压力压缩失败明确终止，超窗单次恢复，SQLite 启动流程补齐中断；不采用 Harness 可选剪枝、插件装配和多摘要模型策略。

## 验证结果与边界

- Windows / bundled Node 24.19.0，System32 前置 PATH；执行 package scripts 对应本地入口，不使用默认 Node 22。
- 离线专项：`node node_modules/vitest/vitest.mjs run tests/integration/compaction --maxWorkers=4`，3 文件、8 项通过（3.41 秒）。
- 完整类型检查：`node node_modules/typescript/bin/tsc --noEmit` 通过。
- 完整后端测试：`node node_modules/vitest/vitest.mjs run --maxWorkers=4`，125 文件、779 项全部通过（48.37 秒）。
- 首次完成的本地无模型预检查：10 文件、62,905 估算 Token，Node 固定开销 2,980、Main 固定开销 5,403，单文件读取成本最大 26,630 字符，小于 29,725 的检查预算；压缩阈值 32,768、尾部预算 6,553，不声明服务端容量。后续目标提示细化后复查预检查。
- 最终本地预检查零模型请求通过：Node 固定开销 3059、Main 5403；证据 `C:/Users/likeW/AppData/Local/Temp/navo-f127-final-preflight-20261018/preflight.json`。
- 真实 `gpt-6-sol` 单次运行失败：358262ms、48 次实际模型调用（含 3 次摘要），请求上限拒绝下一次调用后暂停，脚本非零退出。Node 无 write 权限，无法创建验收协议要求的产物；见 [BUG-014](118-bugfix-bug-014-compaction-acceptance.md)。
- 已验证的真实部分：同一 Node Session 三次成功 pressure 压缩，39242→18301、39964→18401、32837→11249；所有检查点均有后续任务请求。重启前后请求数均为 14，Project / Workspace / 领域状态 / Session 事件和有效历史在内存中严格比较一致；旧 AutoRun 未恢复，显式 start 才继续。
- 未通过的部分：Node A 产物、Main Review、下游 Node B 和最终 Project 完成。不能把上述压缩与恢复成功等同于完整验收成功。
- 真实证据与失败现场见 BUG-014 笔记；未重跑、未扩权、未修改生产代码。PR 与当前 head CI 待填写；草稿 PR 即使 CI 通过，也不能越过真实验收失败的门禁合并。
- 交付为草稿 [PR #79](https://github.com/likeWind221/Navo/pull/79)，实现提交 `03e07e2`；该代码 head 的 CI `verify` 已通过（[run 39107985567](https://github.com/likeWind221/Navo/actions/runs/39107985567)，1 分 32 秒，pnpm typecheck / test 均成功）。收口文档提交继续核对当前 head CI；真实验收未通过，保持草稿、不合并。

## 坑与发现

- Claude Code 不在当前 PATH，但可通过 `C:/Users/likeW/.local/bin/claude.exe` 调用，已确认版本 2.1.302；未修改 Agent 配置。
- F11.4 的固定响应序列不能直接假定每次请求都是任务请求；摘要会插入辅助请求，本阶段脚本须断言请求用途与顺序。
- 审核将中断现场从独立 manual 事务改为 working Node 内的 pressure 事务；重开后断言 compaction interrupted 先于 failed Turn、Node 回 idle、二次重开不重复修复、显式 start 才继续。
- 早期脚本材料仅 58,774 估算 Token，未达到预检查目标；在零模型请求阶段增至 62,905，不修改固定压缩阈值。前期本地预检查失败现场与后续通过报告分别保留，不混成真实运行结果。
- 新增 `tsconfig.json` 两条 include，使脚本与其子实现被仓库完整类型检查覆盖；不改依赖或生产行为。
- 真实运行暴露出方案遗漏：Node Profile 当前只增加 read，不提供 write。全局文件工具注册、类型检查和离线场景通过都不能证明 Node 已有写入授权。新问题登记为 [BUG-014](118-bugfix-bug-014-compaction-acceptance.md)，保持未关闭。

### 模块与文件边界复核

- `scripts/compaction.ts` 编排阶段与退出；`config.ts` 由请求、预检查和场景共用固定预算；`data.ts` 生成虚构材料与独立答案；`protocol.ts` 定义任务和严格 JSON 校验；`setup.ts` 装配 App 与 Project。
- `request.ts` 拥有跨重启请求计数与期限；`watch.ts` 拥有 Session 事件订阅，按已提交日志和 compactionId 去重，回合边界才暂停；`lifecycle.ts` 负责超时取消、收尾和释放，失败保留现场。
- `events.ts` 提取压缩与 Session 证据；`state.ts` 比较 Project / Workspace / 领域状态；`turns.ts` 复用现有 captureTurn 提取实际调用；`checks.ts` 汇总压缩、产物和完成断言。
- 离线按 pressure / overflow / restart 三组测试组织；helpers 拥有 App 和临时文件生命周期，script 提供模型响应，fixture 构造持久前缀，verify 检查事务、配对和恢复，models 为多组测试共用配置。
- 所有手写文件低于 300 行；主脚本 282、测试 helpers 246 行，各自保留同一阶段编排 / 测试资源生命周期。短 config / models 文件被多个消费者共用，不混入生产默认组合。

## 下一步

最新一次授权 Luna 复验已取得完整失败报告：暂停、交接及重启实际通过，但 Main 未正确使用已校验的提交结构信息，两次返工后因截断日志无法核验原始 criteria 而升级。下一步先确认并处理 [BUG-016](120-bugfix-bug-016-review-submission.md) 的审查契约，不盲目重跑；完整真实完成尚未通过，PR #79 保持草稿，不开始 Phase 13。历史失败与中断记录继续保留。

## BUG-014 修订后本机验证

Node 改为通过 completion.summary 提交真实 JSON，由验收脚本校验并原样交接，不新增生产工具权限；实现细节见 [118](118-bugfix-bug-014-compaction-acceptance.md)。新增交接测试后，专项 4 文件 / 13 项、完整 126 文件 / 784 项与类型检查均通过。零模型预检查确认 gpt-6-luna、62905 估算 Token、三个角色所需工具均已提供。首轮 Luna 16 次请求、两次压力压缩，Node A 的全部 JSON 计算正确，但暂停失败，未完成交接与重启。

## BUG-015 修订后验证

观察器新增目标 node/event 订阅，与原 session/event 共同扫描已提交事实；两次 pressure 压缩且 Node A submitted 后才请求暂停，释放时取消两个订阅。无轮询、延时或生产生命周期修改。真实 App 回归在旧代码上失败、新代码上通过，并验证交接后重启零请求与显式启动审查。专项 5 文件 / 14 项、类型检查与完整 127 文件 / 785 项测试通过（52.03 秒）。用户已授权的新一次 gpt-6-luna 复验日志停在第 10 次请求 started，核对时进程已不存在，没有 final / failure 报告，退出原因未知；不能据此判定模型或修复失败，也不能通过验收。证据独立保存在 `C:/Users/likeW/AppData/Local/Temp/navo-f127-luna-20261018-rerun-1555/`；现场只读保留，未自动重跑，尚未关闭 BUG-014 / BUG-015。

## 独立启动器复验（2026-10-18 16:23）

- 用户授权“复验”，并明确“不用 claude-worker”；本轮由 Codex 直接完成，无 worker 调用。独立 PowerShell 启动器记录 PID / 退出码，不使用 Claude background task。
- gpt-6-luna、原始数据与阈值、20 分钟 / 48 请求不变；实际 228077ms、25 请求（22 任务 + 3 摘要），exitCode=1，stage2 的 AutoRun 暂停。
- Node A 首次原始 JSON 的全部数值与异常 ID 正确；已在 Main Review 前暂停，脚本原样交接并发布 Main-owned public Resource。重启严格状态比较通过，请求数 13→13，显式 start 才继续。
- 三次 pressure 压缩成功：36767→17192、38933→18274、34093→12430；第三次发生于返工后。Node A 三次合法提交均含索引 1 / 2 且 satisfied=true，但 Main 两次 rework 后仍因工具日志 300 字符截断而无法核验原始 criteria，最终 escalate；Node B 未启动，完整完成失败。
- 现有清单实际上已暴露归一化自检信息，不能声称所有字段缺失，也不能把本轮归因为压缩遗忘。证据、只读诊断与待审修订方向见 [120](120-bugfix-bug-016-review-submission.md)。未改生产代码或验收条件，未追加运行；BUG-014 / BUG-015 保留完整完成门禁，新增 BUG-016。
- CI 超时修订只将两项长集成测试上限调至 15 秒；最终代码 head a478b76：专项 14 项、类型检查、完整 785 项（49.04 秒）及 [CI run 39110793453](https://github.com/likeWind221/Navo/actions/runs/39110793453) 均通过。此后本轮仅更新文档，收口文档 head CI 按原流程核对。

## 2026-10-18 17:15 复验

gpt-6-luna、代码 head 85d8fd6，177685ms / 24 请求（含 2 摘要），两次压缩、JSON 交接、审查前暂停、重启严格比较与 13→13 零自动请求均通过。Main 一次通过 Node A，Node B 正确执行并提交；随后因缺少可直接读取的原始审查证据 escalate，完整失败。原始材料 Resource 交接与 Main 注册证据的验收禁令冲突已登记 BUG-017；详见 [121](121-bugfix-bug-017-review-evidence.md)。BUG-014 / 015 / 016 的目标行为通过，F12.7 完整完成条件未满足，阶段保持进行中。现场保留，未重跑。
## BUG-017 修复实施（2026-10-18）

已按用户确认支持无资源成果、按标准选择证据与小范围读取；F12.7 补齐 Main 专用精简 RECORD 材料及原始来源入口，Node 仍执行原始大文件读取。定向及零请求 preflight 通过，完整检查 / CI 结果见 [121](121-bugfix-bug-017-review-evidence.md)。修正同时发现的审查 Turn 关联错误见 [122](122-bugfix-bug-018-review-turn.md)。本轮未启动真实模型，历史 24 请求失败现场保留；F12.7 仍为进行中。

## 修复后授权复验（17:55）

代码 9f3532f，182862ms / 24 请求（3 摘要），三次 pressure 压缩、暂停、原样 JSON 交接与重启严格比较通过（14→14 零自动请求）。Main 实际只 fetch 目录 12 行和批次 1 的 8 条原始记录，资源合计 1596 字符，零返工通过 A。B 成功读汇总、批次 1 / 5 后，全局第 24 次模型请求报告 TRANSPORT，未读批次 10、未提交 final、未进入 B 审查，完整验收失败。现场与只读诊断见 [121](121-bugfix-bug-017-review-evidence.md)。未自动重跑，PR 保持草稿，不以部分成功关闭 Bug。
