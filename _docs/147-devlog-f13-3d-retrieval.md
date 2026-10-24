# F13.3d：混合与图局部检索

日期：2026-10-24
状态：✅ 实现、本机完整验证与 PR 当前代码 head CI 通过，PR #93 已 squash 合入 master（0c86f7e）。

## 做了什么

在 F13.3b 的向量检索与 F13.3c 的持久图谱之上，提供实际接入 createApp 的内部 `ctx.retrieval.search()`，支持 `hybrid`（默认）、`vector` 和 `keyword` 三种模式。保留 `ctx.indexSearch.search()` 的原有 Chunk / 余弦分数语义。

```text
Query + Project + Viewer
          |
          v
[new] Validate + visible Resource / folder scope
          |
     +----+--------------------+
     |                         |
     v                         v
[reuse] Vector Top-100   [new] Scoped FTS5 / BM25 Top-100
     |                         |
     +------------+------------+
                  v
[new] Entity seeds + bounded bidirectional BFS
                  |
                  v
[new] RRF + current Chunk / generation check
                  |
                  v
[new] Resource groups + source snippets + relation paths
```

### 模块职责与输入输出

- `src/resource/retrieval.ts`：ResourceRetrieval 服务及请求编排。校验 query、topK、mode 和 maxHops；先按 Resource 权限、resourceIds 与可选 folder（包含后代目录）确定范围。向量调用返回后重新读取权限和目录范围，再执行关键词与图检索。按融合排名重新查找当前有效 Chunk，只返回仍有效的代次，最后按 Resource 去重。
- `retrieval/types.ts`：内部请求与输出协议。topK 是资料数而非 Chunk 数，默认 10、范围 1–100；每份资料最多返回 5 个 Chunk，资料分数为最佳 Chunk 的融合分数。保留 Resource 名称、逻辑路径、资产代次、正文 UTF-16 偏移、标题路径与 PDF 页映射。matches 区分 vector / keyword / entity / graph；paths 保存沿途实体、边的真实方向、遍历方向和每条边的独立来源。没有公共 RPC、分页或 UI 契约。
- `retrieval/lexical.ts`：在单次请求的内存 SQLite 中建立只包含已授权范围的 FTS5 语料，用 BM25 排序。英文按归一化单词索引；中文索引单字与相邻双字，查询多字词使用双字、单字查询使用单字。不把用户输入作为 FTS 运算符执行，关键词是独立转义后的 OR 项。使用 Chunk 的 embedding_text，保留既有标题上下文。无词项返回空列表；最多 128 个不同词项，超过明确拒绝。
- `retrieval/graph.ts`：查询中的完整实体名优先成为种子，补充前 16 个向量与前 16 个关键词结果中出现的实体，总种子最多 16。按确定性顺序进行双向广度优先扩展；关系仍保留原始有向端点，反向经过单独标注 incoming。每个种子到同一实体只保留首条最短路径，避免环路。maxHops 默认 2、范围 0–3；最多 64 个种子/实体访问状态、100 条扩展路径；实体和关系各最多选取前 8 份来源。直接命中实体的证据也可返回，图扩展不生成答案。
- `retrieval/fusion.ts`：三路候选按 `1 / (60 + rank)` 做等权 RRF。每路对同一 Chunk 只计一次分，合并来源标记与路径；分数相同按 Chunk ID 排序。实体命中与关系扩展共同构成图召回这一条排名，不重复增加一路权重。
- `src/storage/retrieval.ts`：按 Project、已授权 Resource ID、当前 active build、当前 ready 正文代次及 Chunker 版本批量扫描和定位 Chunk。Resource ID 每批 200 个、Chunk 每页 256 个；不把全部正文或向量一次性读入 JS 数组。
- `src/resource/graph/read.ts`、`src/storage/graph/transaction.ts` 与相关协议：允许调用方先限定 Resource 范围。可见关系的来源也支持其端点成为可检索实体，即使抽取结果没有额外的实体提及记录；来源去重，不合并私有证据。范围外关系不会成为范围内路径的桥梁。
- `src/resource/index/metadata.ts`：向量和混合入口共用既有标题路径与页码数组的运行时校验，避免新入口仅做类型断言。`src/app.ts` 在 IndexSearch 与 ResourceGraph 之后装配 ResourceRetrieval。

例如资料 A 的 `Alice -> Acme` 与资料 B 的 `Acme -> Lab` 均可见时，查询 Alice 可返回 A、B 及两跳路径，每条边分别指向 A、B 的当前 Chunk。B 不可见或不在指定文件夹范围内时，该边、B 的内容与 Lab 不会通过该路径暴露。

## 关键决策

- **FTS5 使用请求级临时索引。** 直接对全项目持久 FTS 表计算 BM25 会让私有资料参与语料统计。当前只把可见且在指定目录内的 Chunk 加入内存 FTS，使召回与语料统计使用同一权限范围；持久事实仍是原有 SQLite Chunk，重启后重新构建临时索引。因此本 Step 不新增持久表、不迁移 Schema，保持 v7，也不引入依赖。
- 这个选择需要逐次扫描当前范围并构建临时 FTS；全量向量精确检索及图快照读取也仍按现有实现扫描。批量读取不等于整体耗时或图快照内存有固定上限，大规模延迟与内存尚未验证；后续需依据规模证据再决定索引优化。
- SQLite 及局部图处理是同步阶段，取消在调用前、Embedding 返回后和循环检查点观察；不声称同步 SQL 可被其他 JS 事件即时抢占。Embedding 接收原请求 AbortSignal，不新增自动重试；Provider 失败向上传递，不静默降级到关键词模式。无 Provider 时显式 keyword 可使用既有持久 Chunk，hybrid / vector 明确返回 embedding-unconfigured。
- 查询最长 4096 UTF-16 字符；空查询、非法范围与模式拒绝。folder 复用现有逻辑路径校验，目录与 resourceIds 取交集。空范围不调用 Embedding。
- 返回前重新查找当前 active Chunk 和代次，不把等待 Embedding 期间取得的旧正文作为新结果。其他同步阶段没有 await，不在其中交错修改 Resource 状态。
- 只返回当前 Chunk；未 ready、失败或没有 active Chunk 的资料不参与正文检索。资料处理状态展示、无正文资料的元数据搜索、公共错误映射与分页留给后续检索公共接口，不宣称本 Step 已交付它们。
- 本轮不加入查询改写、专用 reranker、社区发现/摘要、全局检索或图可视化。既有 F13.3a 把重排序列为可选，首期不引入未经评测的新模型；F13.4 Agent 工具、F13.3f 公共 RPC / Bridge 和 Renderer 均不提前实现。

## Harness 对照

实施前只读检查 DeepSeek Harness 固定提交 `687f282e8625c6b8d11ff58211a90524be2e4317` 的 `packages/llm/llm-deepseek/src/adapter.ts`，特别是 `generate()` / `request()`：请求使用调用方 AbortSignal，并在请求结束时清理传输。本 Step 沿用 Navo 已有 Embedding Provider 的请求取消边界，在模型返回后拒绝已取消结果；不复制 DeepSeek Messages 传输、看门狗或另一套聊天 Runtime。Harness 此源码不提供本 Step 的 GraphRAG 算法，FTS5、BFS 与 RRF 是 Navo 当前职责内的实现。

- [Harness adapter 源码](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm-deepseek/src/adapter.ts)
- [SQLite FTS5 文档](https://www.sqlite.org/fts5.html)：使用内置 unicode61 与 bm25，中文双字预处理由本项目承担，不声称 SQLite 已提供中文语义分词。

## 坑与发现

- 关系可以有效引用当前输入 Chunk，而端点实体没有独立 chunkIds。局部路径不能仅依赖实体提及行；现在从可见关系的来源补齐端点，不从无权来源补齐。
- 多个种子可能同时包含关系两端。visited 按种子与实体的组合去重，不能在初始化时把所有种子当成全局已访问端点，否则会吞掉正常关系。
- 系统默认 Node 为 v22.23.1，不符合项目 Node 24 要求；验证把 bundled Node v24.19.0 与 Windows System32 放在 PATH 最前。未修改机器全局配置。

## 验证结果与边界

- `pnpm exec vitest run tests/resource/retrieval --maxWorkers=4`：2 文件 / 17 项通过；包含中英文与特殊字符、资料分组和正文偏移、后代目录 / ID 范围、私有 / 跨项目隔离、两跳 / 反向 / 环路与上限、RRF、替换 / 删除、查询期间撤权 / 取消、持久库重开及未配置 Provider 的显式行为。
- 组合专项在新增最后一项前运行：`pnpm exec vitest run tests/resource/retrieval tests/resource/index tests/resource/graph --maxWorkers=4`，8 文件 / 53 项通过。
- `pnpm typecheck` 与 `git diff --check` 通过。
- 完整 `pnpm test --maxWorkers=4`：首次 152 文件 / 980 项中 979 项通过，原有 Fetch 本机连接测试超过默认 5 秒，记录为 [BUG-025](148-bugfix-bug-025-fetch-timeout.md)；分支与 master 定向均通过，未确认根因、不改超时。第二轮相同完整命令 152 文件 / 980 项全部通过，用时 279.98 秒，未设置 NAVO_TEST_MODE，包含完整 Host 进程恢复场景。
- [PR #93](https://github.com/likeWind221/Navo/pull/93) 代码 head `6898b88` 的 [CI run 40102211673](https://github.com/likeWind221/Navo/actions/runs/40102211673) 成功，typecheck、normal tests 与 crash recovery tests 均成功。PR 已 squash 合入 master（`0c86f7e`），远端及本地开发分支已删除，临时 master 对照 worktree 已清理；保留主仓库和既有其他 worktree。本次最终回复交付模块地图、代码导读与验证边界。
- 全部检索输入与模型输出为确定性测试数据和 mock；没有真实 Embedding / LLM API 调用，没有 GPU 作业，不宣称真实中文质量、GraphRAG 优势或大规模性能已验收。

## 下一步

本 Step 完成后，检索公共 RPC 与 Electron Bridge 等后续步骤仍须单独授权；不自动开始 F13.3f 或 F13.4。F13 父项与前端正式页面验收状态保持各自边界。
