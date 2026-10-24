# BUG-027–029：检索事务、实体名称与融合分数

日期：2026-10-24
状态：✅ 三项修复、本机完整验证和当前代码 head CI 通过；PR #95 已合入 master（83c54fa）。

## 现象与复现

- BUG-027：融合候选循环逐个调用 `storage.atomic(tx => tx.getSearchChunk(...))`。无外层事务时每次执行事务提交，存在结构上的不必要开销；不将它描述为已证实的线上性能故障。
- BUG-028：汉字名称通过 `includes` 命中，再按图读取顺序截取 16 个种子。查询“图谱检索”可能同时选中“图”“图谱”“检索”等嵌套名称。
- BUG-029：`RetrievalChunk extends IndexSearchResult` 却将继承的余弦 score 填为 RRF 分数，给后续消费造成语义歧义。

本轮由用户明确授权修复三项问题，当前 Agent 串行维护共享控制面；均属于已有 F13.3d 修复，不分配新 Step。跟踪入口：[Bug 计划](bug-plan.md)。

## 已证实事实与根因假设

`src/storage/database.ts` 的 atomic 在无 pending 时调用 commit，有 pending 才复用事务。现有候选循环没有外层事务。中文 includes 和类型继承均已由源码确认；没有真实服务并发或线上延迟证据。当前双路候选由向量默认 30 / 可配置最多 100 与图谱最多 40 个不同 Chunk 组成，RRF 按 Chunk ID 去重；不会因重复图路径无限增加待校验候选。

## 修复内容

```text
Query + scope
      |
[reuse] Visible vector retrieval
      |
[modify] Exact name spans + longest overlap selection
      |
[reuse] Graph traversal + RRF
      |
[modify] One atomic: source checks + global Chunk selection
      |
[modify] Resource groups + rank + fusionScore
```

### 单次候选事务

`src/resource/retrieval.ts` 的 search 在事务外完成异步向量调用、权限复查、图谱与 RRF，再用一次同步 atomic 执行原候选循环。循环内直接调用 tx.getSearchChunk，保留 active build、ready 正文、Chunker 版本、Resource 资产代次检查与每资料最多 3 个、全局 Top-K 和 rank 规则。不增加存储 API、不修改 SQL 或 StorageService；不在事务中 await、请求 Provider 或做图遍历。资料整理与权限范围仍由 scope 确定，读取后的异常继续交给现有事务边界处理。单次事务减少提交次数，不声称已测得写入等待下降。

### 完整名称匹配

`src/resource/retrieval/graph.ts` 新增同文件 helper `matchEntities(query, entities)`：

1. 将查询及名称做 NFKC 与小写归一；用 Node 24 内置 Intl.Segmenter（zh，word 粒度）收集查询词边界。不增加分词依赖或模型。
2. 只接受名称整体的精确字符出现，开始与结束均须在边界上；不用编辑距离或向量相似度替代名称匹配。单汉字只在查询整体（trim 后）等于该字时直接命中，避免分词器把“图谱”切为“图 / 谱”时重新引入单字噪声。
3. 枚举出现位置，先按名称跨度长到短、查询位置、实体 ID 排序；重叠区间保留最长名称，另一个非重叠位置明确出现的短名称可保留。相同跨度的不同类型同名实体保留，因为仅凭名称不能消歧。
4. 最多选择 16 个不同直接实体；同一名称多次出现不重复种子。图谱实体先按 ID 排序，使直接匹配与同一语义 Chunk 内的实体选择不依赖读取顺序；语义实体仍按向量 Chunk 排名派生，最多 10 个。BFS、两跳、证据与候选上限不变。

例如图中有“图”“图谱”“检索”“图谱检索”：查询“如何使用图谱检索？”只直接选择“图谱检索”；查询“图谱检索与图谱”选择完整名称及后一个独立位置的“图谱”；“地图”不会直接命中单字“图”。短实体仍可能作为语义证据关联实体或真实关系邻居出现，不声称检索结果会完全排除它们。

这是基于完整词边界和最长跨度的词典匹配，不是实体识别/消歧模型。中文词边界依赖 Node/ICU 词典，可能漏掉未收录词或产生不符合领域习惯的边界；拼写错误、别名、指代不做近似匹配，后续应以真实语料评估。不能将规则称为“已经解决中文实体准确识别”。

### 独立融合结果

`src/resource/retrieval/types.ts` 的 RetrievalChunk 独立声明来源、正文、偏移、标题路径、页码、rank、代次、matches 和 paths，不再继承 IndexSearchResult。Chunk 与 Resource 组均将 score 改名 fusionScore；资料组 fusionScore 仍等于其最佳 Chunk 的融合分数。生产入口同步赋值；内部 fuseRanks 保留其局部 score 运算，不改变 RRF 算法。原 IndexSearchResult.score 继续是向量余弦相似度，没有旧字段别名或兼容 fallback。本轮契约是已有内部服务实际使用的结果，不是新公共 RPC。

### 对照来源与不采用项

- [Neo4j RAG 官方说明](https://neo4j.com/docs/neo4j-graphrag-python/current/user_guide_rag.html)：VectorCypherRetriever 在向量命中后执行自定义图查询，不规定统一的中文名称匹配算法。
- [Neo4j Knowledge Graph Builder](https://neo4j.com/docs/neo4j-graphrag-python/current/user_guide_kg_builder.html)：同 label / name 的精确合并及可选语义/模糊 resolver 属于建图后的实体去重，不等同查询阶段实体链接。本次不照搬去重器，也不引入全文召回或 Neo4j 数据库。
- [Cypher 字符串操作](https://neo4j.com/docs/cypher-manual/current/expressions/predicates/string-operators/)：CONTAINS 是子串语义，不能把它描述为完整名称相等。
- 复用已检查的 DeepSeek Harness 固定提交 `687f282e8625c6b8d11ff58211a90524be2e4317`，`packages/llm/llm-deepseek/src/adapter.ts` 的请求取消生命周期；本轮没有改变 Provider/AbortSignal 边界或新增 Runtime、重试、降级。该源码不提供中文实体匹配或本地 SQLite 算法。

## 验证结果与边界

Node v24.19.0，Windows System32 与 bundled Node 临时置于 PATH 前，不改全局配置。

- `pnpm exec vitest run tests/resource/retrieval --maxWorkers=4`：2 文件 / 24 项通过。新增中文完整名称、重叠/独立出现位置、单字、反序图快照、归一化与稳定截断；原全局预算场景补断言仅一次 atomic、结果只包含 fusionScore，保留旧来源/权限/取消/持久化回归。
- `pnpm typecheck` 通过；完整 `pnpm test --maxWorkers=4` 为 152 文件 / 987 项全部通过（267.96 秒）；`git diff --check` 通过。未调用真实 Embedding / LLM API 或 GPU，不改变 BUG-025 的未修复状态。

### 本地耗时对比

`scripts/retrieval/benchmark.ts` 是显式运行的本地对比脚本，不进入生产默认组合或测试默认运行。复用测试用 createApp / 临时持久库与 mock Embedding，创建 12 份资料，每份 12 段。调用实际旧/新 search，vector 模式、vectorTopK=100、topK=10，先核对返回 Chunk ID 与 rank 顺序相同，再统计 atomic 调用，预热 20 对、交替顺序测量 200 对，用 performance.now 统计中位数与 P95，finally 清理本次临时资料库。`ids()` 仅用于对比所选片段顺序；`measure()` 包含完整 search 耗时；`stats()` 排序后取固定样本分位点，没有统计显著性声明。

首次同进程对比：

| 指标 | 修复前 | 修复后 |
|---|---:|---:|
| search 中位数 | 13.4535 ms | 11.9618 ms |
| search P95 | 16.5086 ms | 13.8271 ms |
| 每次 search 的 atomic 次数 | 38 | 2 |
| 其中候选读取事务数 | 37 | 1 |

中位数约减少 11.1%，P95 约减少 16.2%。仍保留的 1 次事务来自向量扫描；实际 SQL 查询条数未因本修复减少。该场景同一资料多个候选被每资料上限跳过，候选阶段检查 37 条才选满 10 个。没有外部网络延迟，不代表默认候选规模、hybrid 名称处理成本或生产并发性能，也不证明所有检索都更快。测量时未同时运行完整套件。中文匹配改动未混入此 vector 模式对比。

复现命令（仓库根目录，Node 24）：

```powershell
git show 4655a58:src/resource/retrieval.ts | Set-Content -Encoding utf8 src/resource/baseline.ts
pnpm exec tsx scripts/retrieval/benchmark.ts src/resource/baseline.ts
Remove-Item -LiteralPath src/resource/baseline.ts
```

baseline.ts 是保持原相对导入的临时旧源码，脚本只通过旧类 prototype.search 调用当前服务实例，不重复注册 Cordis 服务；完成后删除再运行 typecheck。整理后的最终脚本已按上述命令实际运行成功：中位数 13.8381→12.3286 ms，P95 16.7267→15.4687 ms，事务调用仍为 38→2；所选 Chunk ID / rank 顺序相同。中位数约减少 10.9%，P95 约减少 7.5%，与首次变化幅度不同，保留两轮原始统计，不择优替换。两轮测量均没有与完整测试并发，临时 baseline.ts 已删除。代码 head `cdcf0c4` 的 [CI run 40105911443](https://github.com/likeWind221/Navo/actions/runs/40105911443) 已通过 typecheck、normal tests 与 crash recovery tests。

## 后续

当前修改文件为 retrieval.ts、retrieval/graph.ts、retrieval/types.ts、两个检索 spec、本地对比脚本及本修复记录/计划/索引。没有修改 StorageService、存储 SQL、数据库 Schema、依赖或前端代码。未交付公共 RPC/Bridge 或 F13.4。[PR #95](https://github.com/likeWind221/Navo/pull/95) 已 squash 合入 master（`83c54fa`）。BUG-027、BUG-028、BUG-029 分别满足关闭条件；BUG-025 未修复。开发分支本地与远端均删除，无本次专用 worktree 或开发文件夹，保留主仓库与其他既有 worktree；临时 baseline 已清理。最终回复交付模块地图、代码导读与实际边界。
