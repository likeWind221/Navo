# BUG-014：长程压缩验收要求 Node 使用未开放的 write

> 日期：2026-10-18
> 状态：协议修复与真实 JSON 交接已通过；最新复验两 Node 均正确提交，完整完成现被 BUG-017 阻断，未关闭
> 跟踪：[bug-plan.md](bug-plan.md)；阶段记录：[117](117-devlog-f12-7-acceptance.md)

## 现象与复现

F12.7 真实验收使用 `gpt-6-sol`、本地自动压缩阈值 32768，要求 Node A 读取十批虚构材料后写 `out/summary.json`、注册 Resource 并提交完成，Node B 读取结果核对。Node A 完成三次 pressure 压缩，暂停与重启比较通过，但始终无法生成文件，反复报告缺少 write；48 次模型调用预算耗尽后 AutoRun 暂停，脚本非零退出。

- 环境：Windows / bundled Node 24.19.0；代理使用 Node `--use-env-proxy`。
- 命令：`NAVO_EVIDENCE_DIR=<evidence> node --use-env-proxy --import tsx scripts/compaction.ts`。
- 耗时 358262ms，48 次实际模型请求（3 次摘要）；第 49 次尝试在本地拒绝，不调用 provider。
- 证据：`C:/Users/likeW/AppData/Local/Temp/navo-f127-real-20261018/`，含 `preflight.json`、`before-restart.json`、`restart.json`、`failure.json`、`capability-diagnostic.json`。
- 日志：`C:/Users/likeW/AppData/Local/Temp/navo-f127-real-20261018-run.log`。
- 保留数据库：`C:/Users/likeW/AppData/Local/Temp/navo-f127-storage-emScrA/navo.db`。
- 保留 Workspace：`C:/Users/likeW/AppData/Local/Temp/navo-f127-workspace-XY4qLY`。

## 已证实事实与根因假设

- 根因置信度高：`src/node/profile.ts` 的 `NODE_AGENT_TOOL_NAMES` 没有 write，`allowFileRead` 只增加 read；注册了全局文件工具不等于将写工具授权给 Node。
- 实际第一个任务请求公开的工具为 web_search、read、web_fetch、register_resource、fetch_resource、update_resource、delete_resource、send_to_main、submit_completion，确实没有 write。
- 脚本 `scripts/compaction/protocol.ts` 的任务要求却依赖 write；`preflight.ts` 检查固定开销、数据量和读取预算，没有核对任务依赖能力是否公开。
- 三次 register_resource 失败均为源文件 `out/summary.json` 不存在（ENOENT）；文件到退出仍不存在。模型明确表示无法写文件，不是把未完成虚报为完成。
- 压缩及恢复证据：39242→18301、39964→18401、32837→11249；重启前后实际请求数均为 14，显式 start 后才继续。
- 当前证据不能把任务未完成归因于摘要遗忘、压缩算法或 Node 本身应当拥有文件写权限；这是验收协议与已开放能力的错配。

## 修复内容

未修改生产权限或验收协议，未重跑真实模型。Codex 的方案和审核遗漏了 Node 的工具白名单限制；本记录保留失败，不通过扩权或伪造文件使本次结果通过。

拟采用下列最小修订，待确认：

1. Node A 继续真实读取十批材料，在 `submit_completion.summary` 中提交严格 JSON 结果；不要求 write 或注册不存在的文件。
2. 第一次 AutoRun 在两次以上压缩后的回合边界暂停时，要求 Node A 已 submitted，脚本提取其真实 JSON，使用现有严格数值校验器核对后，将原始模型结果落盘为下游输入。证据明确 `writer=acceptance-harness`，不把脚本落盘说成 Agent 文件能力。
3. 脚本用现有 Main Resource API 发布并公开这份真实结果；不将标准答案写成模型输出。Node B 读取共享结果和三批原始材料，重新核对后在自己的 completion summary 提交严格 JSON。
4. Main 沿现有复盘流程分别判断两个 Node；脚本独立校验两个提交的数值、实际读取路径、至少两次 pressure 压缩、重启一致性及最终 roadmap-complete。
5. 预检查增加任务所需公开工具的核对；保持生产工具白名单、数据量、32768 压缩阈值、20 分钟与 48 请求上限。失败现场独立保存，不覆盖本次记录。

这项修订只改变验收材料交接与输出载体，不新增 Node 写文件权限。若用户选择新增 Node 写入能力，应单独设计权限与工具边界，不属于 F12.7 默认范围。

## 验证结果与边界

- 现有离线 3 文件、8 项通过；完整类型检查通过，完整后端 125 文件、779 项通过。它们证明离线压缩/AutoRun/恢复共同工作，不证明错误的真实验收任务可完成。
- 本次真实运行失败，F12.7 保持进行中；不合并阶段 PR、不开始 Phase 13。
- 实现与排查已推送至草稿 [PR #79](https://github.com/likeWind221/Navo/pull/79)，实现提交 `03e07e2` 的 CI `verify` 通过（run 39107985567）；CI 不能替代本项真实关闭条件，收口文档提交仍核对当前 head CI。
- 关闭条件：修订后的验收不依赖未开放工具，预检查可提前发现能力错配；本机完整检查与新 PR head CI 通过；在明确授权的预算内真实完成两个 Node / Main Review、多次压力压缩及重启后的显式续接，并保存结果。

## 后续

用户确认输出载体修订与一次新的真实运行预算后再实施；当前只提交排查与原实现供草稿 PR 审查。修复时遵守独立 Bug 分支要求，不能把本次失败改写为成功。

## 2026-10-18 修订授权与实施

- 用户明确要求“真实模型改用 gpt6-luna，做”，按项目路由采用 `gpt-6-luna`，授权上述 JSON 输出 / 验收脚本交接修订，以及一次新的 20 分钟、48 请求（含摘要）真实复验。
- 从最新 origin/master 建立 `fix/bug-014-compaction-acceptance`，串行接入尚未合并的 F12.7 草稿成果后修复；完成后更新原 PR #79，不混入其他 Step。
- Claude Code 负责脚本和相关离线验证实现，Codex 负责审核、共享文档、真实运行授权与 PR 门禁；不修改生产工具白名单、RPC、前端或依赖。
- 新复验使用独立证据目录；原 gpt-6-sol 失败现场不覆盖。未完成复验前不关闭本 Bug，也不将 F12.7 标为完成。

### 已实施修订

- Node A / B 只依赖 read 与 submit_completion，分别在 completion.summary 提交严格、紧凑的原始 JSON；resource_ids 与 remaining 均为空，不要求 Agent 创建文件或 Resource。
- 新增 `scripts/compaction/handoff.ts`：校验 Node A 原始提交后才落盘，使用 Main 身份发布为 public Resource，证据保存 writer=acceptance-harness、来源 Node / Session / Turn、原始文本和发布结果。Node 的提交本身不被修改；校验失败不写文件、不发布。
- 暂停观察器只有在同一 Node Session 至少两次成功 pressure 压缩且 Node A 已 submitted 后才请求暂停；回合结束后交接材料，再捕获重启比较基线。
- 完成检查直接校验 Node B 原始提交，并可将其原样写成验收脚本产物；不虚构 Node 写入或 Node-owned Resource。仍要求两次实际 Main complete 审查、精确读取顺序及最终 roadmap-complete。
- 预检查对照实际注册 Schema 和各 Profile 工具列表，记录 required / declared / available / missing；能力缺失在调用模型前失败，不做静默补权或 fallback。

### 本机验证

- Windows / bundled Node 24.19.0；System32 与 bundled Node 前置 PATH。
- `node node_modules/typescript/bin/tsc --noEmit`：通过。
- `node node_modules/vitest/vitest.mjs run tests/integration/compaction`：4 文件、13 项通过，包含新增 5 项交接 / 错误 JSON / 工具能力场景。
- `node node_modules/vitest/vitest.mjs run --maxWorkers=4`：126 文件、784 项全部通过，45.99 秒。
- 零模型预检查通过：gpt-6-luna，阈值 32768、retain 6553，数据 62905 估算 Token；Node / Main 固定开销 3110 / 5403，三个角色能力 missing 均为空。证据：`C:/Users/likeW/AppData/Local/Temp/navo-f127-bug014-preflight-final-20261018/preflight.json`。
- 已只读查询当前账号模型列表，包含 slug=gpt-6-luna。新的单次真实复验已派发，结果待填写。

### Luna 单次真实结果

本轮 gpt-6-luna 真实运行在 128684ms、16 次请求后失败停止，未重跑。两次 pressure 压缩成功（36767→17267、37475→17267），Node A 已通过 submit_completion 提交全部正确 JSON，独立校验 ok=true。原 write 能力错配已不再阻断模型提交，但观察器遗漏 endWork 后的 submitted，未能先暂停交接，Main 在交接前开始审查并因证据节选不足 escalate。新问题单独登记 [BUG-015](119-bugfix-bug-015-compaction-pause.md)。完整真实验收关闭条件未满足，BUG-014 暂不勾选；保留这次与原 sol 的两份独立现场。

### 暂停修复后的授权复验

BUG-015 已通过旧代码失败、新代码通过的回归，完整类型检查与 127 文件 / 785 项测试通过。用户授权再复验一次后，独立运行在第 10 次 started 请求后进程中断，没有 final / failure 报告，退出原因未知。只读现场确认两次压力压缩成功，但 Node A 尚未提交，因此没有执行交接或重启；详见 [119](119-bugfix-bug-015-compaction-pause.md)。未自动追加运行，真实完成条件仍未满足，本 Bug 保持未勾选。

### 16:23 独立进程完整复验结果

用户再次授权“复验”后由 Codex 直接执行。228077ms、25 请求后明确失败退出；Node A 正确 JSON 已原样交接、Main-owned public Resource 发布成功，同库重启严格状态比较通过且请求 13→13。Main 因无法从截断日志核验合法提交的 criteria 两次返工后升级，Node B 未启动，见 [BUG-016](120-bugfix-bug-016-review-submission.md)。协议修复目标已经得到真实部分证据，原关闭条件中的完整完成仍未满足，保持未勾选；不修改历史失败记录。

## 2026-10-18 17:15 复验

gpt-6-luna、代码 head 85d8fd6，177685ms / 24 请求（含 2 摘要），两次压缩、JSON 交接、审查前暂停、重启严格比较与 13→13 零自动请求均通过。Main 一次通过 Node A，Node B 正确执行并提交；随后因缺少可直接读取的原始审查证据 escalate，完整失败。原始材料 Resource 交接与 Main 注册证据的验收禁令冲突已登记 BUG-017；详见 [121](121-bugfix-bug-017-review-evidence.md)。本项自身目标行为通过，保留原完整完成关闭条件，未勾选。现场保留，未重跑。