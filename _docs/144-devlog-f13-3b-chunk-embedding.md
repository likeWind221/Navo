# F13.3b：Chunk 与 Embedding 索引实施

日期：2026-10-23
状态：✅ 生产实现、本机验证与 PR #91 代码 head CI 已通过；等待人工审核，不自动合并
基线：`master` 提交 `53b2428`，开发分支 `phase13-f13.3b-chunk-embedding`

## 做了什么

- 新增确定性 Chunker：按 Markdown 标题、代码围栏、表格、列表和普通段落识别结构，超长内容按句子、子句、换行与 Unicode code point 安全边界逐级切分；默认软目标 1,200、硬上限 1,600、重叠目标 150，保留 UTF-16 原文偏移、标题路径和 PDF 页码交集。
- 新增独立 `EmbeddingProvider` 与 OpenAI-compatible Qwen3 客户端：默认模型 `Qwen/Qwen3-Embedding-0.6B`、1024 维；文档与查询使用独立版本模板，支持乱序响应恢复、整批校验、请求体 / 输入 / 批量限制、413 / 明确超限拆批、60 秒超时、最多三次有限重试、`Retry-After` 和取消。
- SQLite Schema 从 v5 升至 v6，仅新增 `resource_index_builds` 与 `resource_chunks`。Chunk 与 Float32 little-endian L2 归一化向量同表保存；部分唯一索引约束每个 Resource 最多一个 `building` 和一个 `active` build。
- 新增 `ResourceIndexProcessor`：监听正文状态、按当前 `assetGeneration` 构建、逐批事务落盘、从 `embedding IS NULL` 恢复、最终短事务原子发布；失败和显式取消不暴露半成品，重复通知不取消同代构建，失败代次仅在显式 `retry` 后重试。
- 新增内部 `IndexSearch`：查询向量化后，先按 Project 与当前可见 Resource ID 在 SQL 中限定活动索引，再按最多 256 条候选分批扫描，维护有界精确 Top-K，并在返回前复核权限、Resource 存在性和 `assetGeneration`。
- Host 新增可选 `EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL`、`EMBEDDING_REVISION` 配置；未配置时正文处理不受影响，索引状态为 `waiting-config`，搜索明确返回未配置错误。密钥不进入 SQLite、错误文本或普通日志。

## 关键决策

- 外部 Embedding HTTP 调用不持有 SQLite 事务；只有完整校验后的一个批次才在单事务中写入。
- 活动索引仍由 build 状态表示，不增加批次表、向量表或活动指针表。崩溃恢复以 NULL 向量为未完成事实，允许 HTTP 已成功但落盘前崩溃时重发。
- 精确检索不一次载入全项目向量：可见 Resource ID 每 200 个分组，Chunk 每 256 条读取，Top-K 容器始终受 `topK <= 100` 限制。
- 使用 Node `Buffer` 实现 Float32 little-endian 编解码和点积，没有增加数学 SDK、向量数据库或原生扩展。
- 与冻结设计一致，未实现 FTS5 / BM25、混合排序、实体关系 / GraphRAG、多跳检索、公共 RPC、Electron Bridge 或 Renderer UI。

## 坑与发现

- OpenAI-compatible 响应按 `index` 写入预分配数组时，稀疏数组会让 `Array.some` 跳过缺项；实现改为逐索引检查，专项测试覆盖缺失与重复 index。
- Schema v6 使既有迁移测试在模拟 v2 / v3 / v5 前必须先删除两张新表，否则会把测试夹具错误地保留为“旧库”。迁移链现覆盖 v1–v5 到 v6。
- 完整套件全局并行时出现多项既有 5 秒超时；对应失败文件单独复跑全部通过。随后按目录覆盖全部 146 个 spec 文件，并将耗时约五分钟的 `tests/host/process.spec.ts` 单独以 verbose 跑完，避免把真实强杀恢复场景的长静默误判为挂起。
- PR #91 首个 head `67727b8` 的 CI normal tests 出现 3 个既有用例 5 秒超时，143 / 146 个文件通过，F13.3b 自身用例全部通过但磁盘夹具耗时 6.4 秒。未调整既有超时或 worker 数；将除重启恢复外的新增索引集成测试改用内存 SQLite，保留恢复场景使用真实磁盘库，随后与三个超时文件以 CI 相同四 worker 复跑 14 项通过。后续 CI 结果仍以新 head 为准。

## 验证结果与边界

- Node `v24.19.0`：`pnpm typecheck` 通过。
- F13.3b 与迁移专项：8 个文件、39 项通过，覆盖 Chunk 切分 / 偏移 / 页码、Provider 异常与拆批、Schema v1–v5 迁移、构建发布、失败 / 取消、替换 / 删除、权限过滤和中断恢复。
- 完整测试按目录分组覆盖仓库全部 146 个 `.spec.ts` 文件，共 933 项通过：核心 43 文件 / 293 项，Host 常规 17 / 85，Host 真实进程 1 / 26，LLM 12 / 81，Integration 14 / 24，Project + Resource + Tools 59 / 424。
- `git diff --check` 待最终文档与提交前复核。
- 所有 Embedding 协议与检索链路均使用 mock Provider；没有连接用户的 Qwen3 服务，没有形成真实模型召回质量、延迟、Token 上限或请求体上限结论。
- PR #91 代码 head `a58aa47` 的 GitHub Actions run `39899109070` 已成功；本 Step 的实现和验证完成。PR 按用户要求等待人工审核，不自动合并。

## 下一步

人工审核 PR #91。真实 Qwen3 API smoke test 需用户另行提供配置并明确授权，不属于 CI 门禁；本次不开始 F13.3c 或后续步骤。
