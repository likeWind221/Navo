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
