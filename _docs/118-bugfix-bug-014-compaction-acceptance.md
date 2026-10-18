# BUG-014：长程压缩验收要求 Node 使用未开放的 write

> 日期：2026-10-18
> 状态：仅排查，未修复；真实验收失败，不关闭
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
