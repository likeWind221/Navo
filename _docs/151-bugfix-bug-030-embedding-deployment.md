# BUG-030：Embedding 与实际部署模型对齐

日期：2026-10-25
状态：本地完整验证与真实 smoke test 通过，等待 PR CI 与合并。

## 现象与复现

F13.3 真实验收准备期间发现客户端默认使用 Qwen3-Embedding-0.6B 和 1024 维，与 server:8081 部署记录中的 4B / 2560 维不一致。2026-10-25 只读访问 `/v1/models` 确认实际服务名为 `Qwen3-Embedding-4B`。用户明确要求按部署模型适配，并授权最多 10 次 Embedding 请求的小规模 smoke test。跟踪入口：[Bug 计划](bug-plan.md)。

## 已证实事实与根因假设

`src/embedding/openai.ts` 固定校验 1024 维，`src/host/config.ts` 同样默认旧模型名。旧配置无法接收 2560 维响应；实际旧配置请求失败尚未运行，不把静态不兼容说成已发生的线上故障。

## 修复内容

- Provider 默认模型名改为部署服务名，固定维度改为 2560。保留文档/查询模板、完整响应校验与既有错误/取消行为；不发送降维参数。
- Host 默认模型名同步更新；仍须显式设置 `EMBEDDING_BASE_URL` 才启用向量服务，保留自定义模型名设置。
- 更新已有 Provider / Host 回归，包含拒绝旧 1024 维响应。
- `scripts/retrieval/smoke.ts` 使用独立临时目录与 SQLite，导入三篇中文短资料，通过真实 Provider 构建索引，执行 vector / hybrid 查询、原文偏移校验、Node 私有资料隔离和同库重开。实际 HTTP 请求限 10 次，单次 15 秒、整轮 180 秒、最多一次尝试；失败即抛出并保存结果，不自动重跑。混合入口未配置生成模型，因此只有向量证据，不伪造图谱。
- 索引现有兼容性判断已包含模型名与维度；旧索引不能冒充新模型索引，无需修改 Schema 或截断/补齐旧向量。

不改前端、公共 RPC、生成模型、图谱抽取算法、数据库结构或 server 服务配置。历史设计 [143](143-devlog-f13-3b-chunk-embedding-design.md) 与首次实施 [144](144-devlog-f13-3b-chunk-embedding.md) 的 0.6B / 1024 维描述保留为历史事实，当前配置由本记录替代。

## 验证结果与边界

环境：Windows PowerShell，bundled Node v24.22.1；仅当前命令 PATH 将 Windows System32 与 Node 放在前面，不修改系统环境。

- `pnpm exec vitest run tests/embedding tests/host/config.spec.ts tests/resource/index tests/resource/retrieval --maxWorkers=4`：6 文件 / 52 项通过。
- `pnpm typecheck` 通过。smoke 脚本额外以 `pnpm exec tsc --ignoreConfig --noEmit --target ES2024 --module ESNext --moduleResolution Bundler --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck scripts/retrieval/smoke.ts src/tools/builtins/fetch/output/gfm.d.ts` 通过类型检查。首次命令缺少 TS7 要求的 `--ignoreConfig`，第二次发现脚本数组需显式类型并需加载已有 gfm 声明；修正后检查通过，这两次均未发模型请求。
- `pnpm exec tsx scripts/retrieval/smoke.ts`：一次执行通过，模型 `Qwen3-Embedding-4B`、2560 维，9 次 HTTP 请求全部 200。3 篇资料均产生 active 索引；两次 vector 与两次 hybrid 查询 Top-1 全部符合预期，包含英文问题召回中文正文。Node 不返回私有资料及其预算内容；返回 Chunk 的 UTF-16 偏移精确对应正文；重开后 active build ID 保持一致且不重新调用文档 Embedding，重开后的查询仍通过。
- 原始 JSON 与临时数据库保留在 `C:\Users\likeW\AppData\Local\Temp\navo-retrieval-smoke-G3b35A\`，结果文件为 `result.json`。流程耗时 2054 ms，4 个带排名断言的查询端到端耗时 166–209 ms；HTTP 工具计时为收到响应头的时间，不当作完整响应读取耗时。样本极小、无并发，不代表吞吐或质量评测。Top-K 会包含不相关的低排名资料，本轮不验证无答案拒答或相似度阈值。
- 完整 `pnpm test --maxWorkers=4`：152 文件 / 988 项全部通过，288.28 秒；未设置 NAVO_TEST_MODE，保留完整进程恢复测试。`git diff --check` 通过。PR CI 待填写。

真实测试仅覆盖 Embedding、索引与检索；未调用生成模型，未验证真实实体关系抽取或多跳图谱效果。未改动 server 配置或业务库，不启动后续 Step。

## 后续

验证通过后按仓库规则提交 PR，当前 head CI 通过后合并；不启动后续 Step。
