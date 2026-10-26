# 160：F13.6 OpenRouter 后端完整验收复验

日期：2026-10-26。基线 master `7e84f59`，分支 `phase13-f13.6-openrouter-acceptance`。用户明确要求用 OpenRouter 完整验收，并决定不再排查 BUG-032 原 Qwen 端点。本轮为一次真实运行，失败停止，不自动重跑。

## 做了什么

- `scripts/library/runtime.ts` 复用 `resolveEmbeddingConfig` / `createEmbeddingProvider`，替换直接创建 Qwen 适配器的装配。真实模式缺少配置时在创建临时库前拒绝；零推理预检不解析 Embedding 配置、不创建 Provider。
- 保持 48 次生成、20 次 Embedding、20 分钟上限，`maxModelRetries=0`、Embedding `maxAttempts=1` / `timeoutMs=15000`。没有修改生产适配器、模型、检索、前端或远程服务。
- `scripts/library.ts` 的 intake 证据新增 Provider ID、模型和维度，不保存 Key；重开仍复用同一 Provider 与计数器。
- 显式设置 `EMBEDDING_PROVIDER=openrouter`；Embedding 使用 `nvidia/nemotron-3.5-embed-1b:free` / 2048 维，图谱和任务生成仍为既有 `openai / gpt-6-luna` 订阅路径。

## 关键决策

真实范围为三份合成资料导入、索引与图谱、Main 规划、Node A、Main Review 与定向共享、同库重开、Node B 和最终 Review；结果必须以实际工具读取与持久状态判定。成果仍由 Human 验收脚本原样物化，不宣称 Node 获得写文件权限。Bridge、Renderer、规模质量评测与原 Qwen 端点恢复不在范围内。

## 验证结果与边界

- 环境：Windows PowerShell、bundled Node v24.22.1，当前进程 PATH 将 System32 与 Node 24 置前；没有改持久配置或安装依赖。
- 根包类型检查、临时配置纳入验收入口与 ambient declarations 的严格类型检查均通过。
- 零推理预检通过，0 生成 / 0 Embedding，现场 `%TEMP%/navo-f136-real-Rlfdhp`。
- 唯一一次真实运行在 intake 阶段 48757ms 后失败；3 份正文 ready，Embedding 3 次尝试分别为 HTTP 200 / status=0 / HTTP 200，耗时 1021 / 15016 / 8232ms。第二次未在 15 秒内收到响应，向量构建 failed / request-failed，其余两份 active。
- 两份成功索引的资料已完成真实图谱构建，graph_builds 均 active / next_ordinal=1，pipeline 为 `graph-v2-explicit-parameters`，可选参数均 null；证明旧 BUG-031 的参数拒绝在本次两份资料上没有复现。
- 生成账本记录两次图谱调用，状态仍为 started；`collectStream` 在 finish 事件退出迭代，而 `createGuardedAdapter` 在迭代正常耗尽后才更新状态。因此本轮以 SQLite 的 graph active 判定构建成功，不把账本 started 解释为仍在运行，也不声称账本已记录完整 HTTP 完成状态。本轮不修改共享账本机制。
- Main 规划、Node A / B、Review、成果物化、重开验收均未执行到；完整链路未通过。新阻塞记为 [BUG-033](161-bugfix-bug-033-openrouter-timeout.md)，不重跑、不调整超时，不复用原失败库。
- 真实现场 `%TEMP%/navo-f136-real-1c6qU9`，保留 SQLite、intake、workspace、evidence；日志目录 `%TEMP%/navo-f136-openrouter-20261026`，含 typecheck.log、script-typecheck.log、preflight.log、real.log、full.log。
- 完整本地 `NAVO_TEST_MODE=all node node_modules/vitest/vitest.mjs run --maxWorkers=4`：165 文件 / 1054 项全部通过，313.22 秒，包含完整进程恢复组；日志 `full.log`。根包与脚本严格类型检查、零推理预检及差异空白检查通过。
- 本轮以 Draft PR 保留脚本接入与失败记录，不因离线或 CI 通过合并未完成的真实验收；PR 链接与当前 head CI 结果随交付回复提供。

## 坑与发现

独立 Embedding smoke 通过不代表后续每次请求都能在验收脚本的 15 秒预算内返回。本次只确认一项请求超时，不能区分服务延迟、传输或代理路径，也不能据此断言 OpenRouter 服务持续不可用。BUG-031 已有真实图谱成功证据，但完整任务关闭条件尚未满足；BUG-032 按用户决定搁置，不能标成已修复。

## 下一步

F13.6 保持进行中，前端状态不变。保留本轮失败现场与 Draft PR；下一次真实运行需要先明确单次超时取值及预算并获得授权。代码导读将在本轮交付中说明统一配置、Provider 装配与证据记录。

## 用户授权的 60 秒后续复验

用户随后明确回复“做，改为 60 秒并再验收一次”。仅将验收入口 Embedding `timeoutMs` 从 15000 改为 60000，保持单次尝试、48 次生成 / 20 次 Embedding / 20 分钟、失败即停；使用新的临时库，前次现场不变。旧 Draft PR 为 [#105](https://github.com/likeWind221/Navo/pull/105)，当前真实结果与最终验证待完成后追加。

本轮在 41993ms 后因规划阶段 `0 !== 2` 停止。三次 Embedding 全部 HTTP 200（1220 / 534 / 467ms），3 份索引和真实图谱全部 active；生成调用计数 4（3 图谱、1 Main）。Main 正确复述目标并询问是否规划，但旧验收入口没有发送确认回合，登记 [BUG-034](162-bugfix-bug-034-acceptance-confirmation.md)。现场 `%TEMP%/navo-f136-real-SDBHo0`，日志 `real-60s.log`；未在该库补跑。

脚本已按既有 longterm 验收补齐请求、无计划 / 零 Node / 目标不变断言、Human 确认、实际规划。修正后严格类型检查和零推理预检通过；用户再次明确授权一次真实复验，仍保留 60 秒 / 单次尝试与原总预算。日志 `real-confirm.log`，结果待追加。

## 修正确认流程后的第三轮真实结果

- 用户明确回复“做，用修正脚本再验收一次”；独立现场 `%TEMP%/navo-f136-real-3yfalI`，175790ms 后停止。
- 生成适配器调用计数 18，其中图谱 4；Embedding 6 次全部 HTTP 200，耗时分别 13166 / 14993 / 414 / 996 / 1764 / 1232ms。没有调用原 Qwen GPU 服务。
- 三份源资料和 comparison.md 的索引 / 真实图谱均 active；Main 目标确认与两 Node 规划通过；Node A 实际检索得到图谱路径并读取三份原文，答案判据通过；Human 脚本原样物化成果，Main 实际读取、审查 complete 并定向共享。
- 同库重开断言通过：权威持久状态相同，请求计数保持生成 15 / Embedding 5，无 AutoRun，未触发隐式推理。Node B 在显式动作后启动。
- Node B 读取 comparison.md 与 constraints.md 并搜索，提交数值和冲突 / 缺项说明正确的答案，但 source_ids 多列两份未在本回合 fetch 的原文，严格判据拒绝，登记 [BUG-035](163-bugfix-bug-035-node-source-evidence.md)。最终 Main Review 与整体 passed 未执行到，不能宣布完整验收通过。
- BUG-031 旧参数错误在三份原文和成果的真实图谱中均未复现；BUG-033 改为 60 秒后后两轮 Embedding 请求全部 200，但外部延迟原因未定位，完整任务关闭条件未满足。BUG-034 修正确认流程后真实两回合与后续任务已通过，仍待最终 PR head CI 门禁。
- 60 秒设置下再次完整本地检查：根包类型检查通过，165 文件 / 1054 项全部通过，377.60 秒，含完整进程恢复；日志 typecheck-60s.log / full-60s.log。随后只修改验收脚本确认流程，脚本严格类型检查、零推理预检通过，零推理现场 `%TEMP%/navo-f136-real-oVoqF6`。
- 首次提交 `3368638` 的 CI run `40324804820` 普通测试有 5 项超时（shell/execution、library/flow、library/failure），没有修改相应测试或生产实现，不断言根因已确认；原日志 ci-first-failed.log 保留。后续当前提交门禁另核对，不修改超时或绕过 CI。
- 最终相关回归 `tests/integration/library`、`tests/tools/shell/execution.spec.ts`、`tests/tools/project/goal.spec.ts`、`tests/host/project/goal.spec.ts`：6 文件 / 24 项通过，11.22 秒；日志 final-related.log。包含首轮 CI 超时所在文件；与 master 的对应生产 / 测试代码无差异，但本轮没有运行独立 master 对照，不能据此确认 CI 环境根因。

最新下一步：BUG-035 已确认为验收脚本来源契约缺陷并按方案 A 修复（直读由 fetch 轨迹证明，`source_ids` 只校验可追溯性），完整本地 1056 项与 CI run `40334741718` 已通过；第四轮真实复验见下节。F13.6 后端链路随后通过，父项仍待正式 Renderer；PR #105 已 squash 合入 master（`9f3514e`），最终 head `9bb94a4` 的 CI run `40337394723` 通过（4m6s）。前端 / Bridge / Renderer 与原 Qwen 端点不在本轮验收范围。代码导读随本轮最终交付提供。

## 第四轮：来源契约修复后的完整真实任务

用户授权一次真实复验，仍为 48 生成 / 20 Embedding / 20 分钟、单项 Embedding 60 秒、失败即停。零推理预检通过（`%TEMP%/navo-f136-real-cGL8qS`，0 请求）。

- 现场 `%TEMP%/navo-f136-real-R8uzdx`，282093ms，`outcome=passed`；生成 22 次（图谱 5）、Embedding 7 次全部 HTTP 200；模型 `openai / gpt-6-luna`，Embedding `openrouter / nvidia/nemotron-3.5-embed-1b:free` / 2048 维。
- Main 确认与两 Node 规划、Node A 三份原文检索与读取、Review A 物化成果与定向共享、同库重开状态和请求数不变、Node B 读取交接与约束、最终 Review B 全部通过；两 Node 均为 `completing`，最终 Main Review 实际 fetch `recommendation.md` 并判 complete，`unrecovered=0`。
- Node B 的 `source_ids` 为 comparison 与 constraints 两项，均在本回合实际 fetch；本轮未再出现额外搜索 / 上游来源声明。离线回归另行覆盖“额外支持来源可通过”和“未出现 ID 拒绝”两个分支。
- 因此 BUG-035、BUG-031、BUG-033、BUG-034 的完整任务关闭条件均已满足；F13.6 后端完整链路通过，父项仍待正式 Renderer 验收。Bridge / Renderer、原 Qwen 端点与规模质量评测不在本轮范围。
- 日志 `%TEMP%/navo-f136-openrouter-20261026/real-bug035.log`；证据 `evidence/result.json`、`5-node-b.json`、`6-review-b.json` 与 `navo.db` 原样保留。
