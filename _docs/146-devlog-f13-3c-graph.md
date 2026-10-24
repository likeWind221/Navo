# F13.3c：实体关系抽取与图谱持久化

日期：2026-10-24；基线：master `1b61b68`；分支：`phase13-f13.3c-graph`。
状态：✅ 实现、本机验证与 PR #92 最新 head CI 通过；2026-10-24 用户追加授权合并，已合入 master（de2bb17）。不开始 F13.3d。

## 冻结设计

1. 复用 LLMService，按 Token 预算将多个 Chunk 组批。优先工具调用结构化参数，兼容严格 JSON 文本；输出必须通过运行时 Schema 校验。关系必须包含主体、客体、类型、来源 Chunk ID。仅格式错误或输出超限允许有限重试和拆批。
2. 基础 Graph Pruning 校验字段、类型、实体引用与批内来源；关系两端必须存在于本批实体中。无效引用与来源被剔除，不逐条匹配原文，不做二次 LLM 语义审核。
3. 仅同一 Project 内按实体类型与规范化名称精确合并。名称采用 Unicode NFC、首尾空白去除和连续空白折叠，保留大小写；不做模糊、向量或 LLM 消歧。
4. 关系按 Project、主体 ID、类型、客体 ID 去重，方向不可交换；每个来源 Chunk 独立保存证据。
5. 继续使用 SQLite 迁移；复用 resource_chunks 和 resource_index_builds，不复制正文或 Chunk。现有 Schema v6 无图谱表，新增构建、实体、关系、证据四张表，升级 v7。
6. 构建绑定 Resource、assetGeneration、源 Chunk build 和 pipeline 版本。替换、删除或源索引版本变化撤销旧证据，仅清理失去全部证据的实体和关系，保留其他来源支持的共享事实。失败和取消不发布，重启恢复 building，显式 retry 恢复失败进度；完整构建原子切换。读取先按 Resource ACL 限定来源，实体合并不赋予额外权限。

## 模块与关键决策

- `src/resource/graph.ts`：任务生命周期、通知、取消、恢复和显式重试；`graph/extraction.ts`：预算组批和 LLM 调用；`graph/validation.ts`：输出 Schema 与基础清理；`graph/store.ts`：版本和来源对齐；`graph/read.ts`：权限内读取。
- `src/storage/graph.ts`：存储协议；`storage/graph/`：表定义、构建事务、事实与证据事务。独立构建状态机，避免把图谱状态混进 Embedding 状态。
- `src/app.ts`：可选 graph 配置和服务装配；未配置不触发模型调用。复用现有 LLM Adapter，调用者在 createApp 返回后立即注册 Adapter，或在手动装配后、start 前注册；缺少 Adapter 会明确失败，需要配置后显式 retry。启用 graph 会将 Chunk 正文发送给配置的 LLM Provider。
- 使用已发布的当前 Chunk build 作为输入；不另建 Chunk 层，因此当前实现依赖 F13.3b 成功完成。源 build ID 改变也触发图谱重建。
- 构建进度记录 next_ordinal，与本批证据同一事务保存；空结果也推进进度。重启不重复已提交批次；中断但未落盘的调用允许重发。
- 不存共享描述或别名，避免合并时把私有来源内容带入公共实体；实体只保存规范化名称和类型，证据始终独立。
- 默认输入预算 8192、输出上限 4096 token；输入按序列化请求 UTF-8 字节数保守估算并保留协议余量，不宣称精确 tokenizer。单 Chunk 超预算明确失败。每批格式/超限最多两次，之后二分，单 Chunk 不再拆。请求有取消和时限，输出流累计有大小边界。

## 参考与差异

只读检查 DeepSeek Harness 固定提交 `687f282e8625c6b8d11ff58211a90524be2e4317` 的 `packages/llm/llm-deepseek/src/adapter.ts` 与 `packages/core/tools/src/json-schema.ts`：采用调用级 AbortSignal 合并、结束清理和显式运行时结构校验；不复制 DeepSeek 专用传输、工具框架或完整 Schema 引擎。

参考 [Neo4j GraphRAG 基础清理](https://neo4j.com/docs/neo4j-graphrag-python/current/user_guide_kg_builder.html)：检查结构和有效端点，剔除无效引用；Navo 额外约束来源属于当前输入批次，不引入 Neo4j 存储，不声称完成语义事实核验。

## 范围外

不实现 F13.3d 混合检索、多跳、融合排序；不实现社区发现/摘要、图谱可视化、前端、规则引擎、置信度或二次模型审核；不修改公共 RPC、Electron Bridge。

## 验证结果与边界

- Windows PowerShell / Node v24.19.0；专项命令：`pnpm exec vitest run tests/resource/graph tests/storage/schema.spec.ts tests/storage/content.spec.ts tests/storage/operations.spec.ts --maxWorkers=4`，7 个文件 / 40 项通过。
- `pnpm typecheck` 通过。
- `pnpm test --maxWorkers=4`：全部 150 个文件 / 959 项通过，用时 379.78 秒；未设置 NAVO_TEST_MODE，包含完整 Host 进程恢复场景。运行前将 Windows System32 与 Node 24 runtime 放在 PATH 最前。
- `git diff --check` 与提交前暂存区空白检查通过。
- 所有抽取用 mock LLM，无真实 API 调用；不声称抽取质量已验证。图谱重启专项通过停止服务并重开真实磁盘库验证，不冒充图谱 SIGKILL 进程级验收。

## 下一步

PR #92 已按用户明确授权合并。F13.3d 尚未授权，不提前实施。

## 工作区与代码审查说明

本轮使用独立 worktree。2026-10-24 用户追加授权将 BUG-024 纳入同一 PR；索引兼容性修复与四项回归已并入，记录见 [145](145-bugfix-bug-024-index-compatibility.md)。本轮开发记录编号为 146。新模块均未超过 250 行；`graph/errors.ts` 保持独立可抛出错误边界，`storage/graph/facts.ts` 封装实体、关系与证据的共同写入/清理规则，供构建事务使用。数据库结构通过四张表表达，无新依赖。

## 实现审查入口

- GraphExtractor.batch / extract / call：序列化请求预算、两次格式重试、二分批次、流式上限、超时与取消清理。
- validateGraph：严格字段类型与数组上限；normalizeName 保留大小写；清理空类型、无效端点和批外来源，不做语义验证。
- GraphStore.sources / current / reconcile / next：当前来源、版本对齐与构建选择；ResourceGraph.run 将每个子批结果与 next_ordinal 一起提交，停机保留 building，失败或取消等待显式 retry。
- graphTransaction：writeGraphBatch 校验连续范围和来源；publishGraphBuild 仅发布完整当前构建；writeFacts 通过唯一键合并和去重；removeFacts 仅删除失去来源的事实。
- readGraph：先 listVisible，再按可见 Resource 查询当前已发布证据；不聚合不可见来源数量或内容。

本 Step 没有仅声明未接入的生产协议；服务通过可选 NavoAppConfig.graph 接入，Host 环境变量、公共检索接口和真实 LLM 质量验证不在本轮交付中。代码导读随最终回复交付。

## BUG-024 合入后的验证

2026-10-24：按用户要求将 [BUG-024](145-bugfix-bug-024-index-compatibility.md) 纳入 [PR #92](https://github.com/likeWind221/Navo/pull/92)。索引与图谱组合专项 7 文件 / 39 项、typecheck、完整 150 文件 / 963 项（352.98 秒）及 diff 检查通过。原 head `060a5ae` 的 CI run `40059416429` 成功；该结果不覆盖后加入的修复，最新 head `bc5bd11` 的 CI run `40060389161` 已成功。用户随后明确授权合并，PR #92 已 squash 合入 master（`de2bb17`）。
