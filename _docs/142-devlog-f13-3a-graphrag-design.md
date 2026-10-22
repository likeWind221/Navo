# F13.3a：GraphRAG 后端技术设计草案

日期：2026-10-22  
状态：🔄 设计草案，待用户审核；未修改生产代码  
基线：当前 `master`；F13.1b / F13.2a / F13.2b 已交付  
范围：只读审计与技术设计。本文获确认后，才进入后续实现 Step。

## 1. 目标与产品边界

用户已明确决定：F13 采用 GraphRAG 路线，语义检索和知识图谱均属于目标能力。本决定更新 F13.0 最初将知识图谱排除在首版之外的历史边界；F13.0 记录保留为当时的决策记录，不追溯改写。

目标是在项目级 Resource 资料库上，形成可恢复、可增量更新、按权限检索、可回到原文核验的 GraphRAG 后端。它既能查找语义相关的正文片段，也能通过实体关系发现跨文档关联，并支持局部关系检索与面向全库问题的社区摘要检索。

不改变现有 Resource 身份、owner / access、项目隔离和 Human Gate；不自动唤醒 Agent；不实现跨项目知识库、Session / 压缩历史召回、外部知识库同步、OCR、Renderer 搜索页面或正文预览。本 Step 不修改生产代码、数据库、RPC、Electron Bridge 或前端。

## 2. 只读审计结论

### 2.1 现有资料处理可复用

- `src/resource/content.ts` 的 `ContentProcessor` 已负责后台正文处理、显式重试、取消、停机等待和启动恢复；处理失败不会导致原始 Resource 丢失。
- `src/storage/content.ts` 的 `resource_content` 每个 Project / Resource 只保存当前正文行，记录 `source_asset_generation`、处理状态、正文、PDF 页映射和提取器版本。状态包括 `pending / processing / ready / metadata_only / failed`。
- `src/resource/content/store.ts` 会对齐当前 Resource 的 `assetGeneration`，防止旧代次的正文结果被当成当前正文。
- `src/resource/lifecycle.ts` 的读取租约固定一次读取所使用的资产代次；删除 Resource 时，在同一事务删除对应正文行，后续新读取会被拒绝。
- `src/resource/access.ts` 的 `canReadResource` 是当前 Resource 访问权限的领域规则。GraphRAG 不得仅凭实体或关系在图中存在，就向调用者暴露其无权读取的来源。

### 2.2 现有模型层不提供 Embedding

- `src/llm/service.ts` 的 `LLMService` 通过注册的 Provider Adapter 提供流式文本 / 工具调用生成。
- `src/llm/types.ts` 的 `GenerateRequest` 具有 provider、model、messages、tools 与 AbortSignal，但没有 Embedding 请求、向量维度或批量向量结果协议。
- 当前 `src/llm/adapters/openai.ts` 与 `qwen.ts` 是聊天生成适配器，不能据此认定已支持对应供应商的 Embedding API。
- 因此图谱抽取可以复用现有 LLM 生成能力；Embedding 需要单独的最小 Provider 契约，不能伪装成聊天请求，也不能假定所有 Chat Provider 都提供 Embedding。

### 2.3 持久化和装配边界

- 当前 SQLite Schema 为 v5，正文处理为 v4、资料目录为 v5；新增持久化必须沿现有迁移机制单向升级，并覆盖旧版 v5 数据库迁移测试。
- `src/app.ts` 按 Cordis Service 装配应用，现有正文处理器在 Resource Recovery 之后挂载，并在应用装配结束后启动。
- 当前依赖中未发现 GraphRAG 框架、Embedding SDK 或向量索引依赖。没有证据表明当前已有 Chunk、Embedding、实体关系、社区摘要或 GraphRAG 检索实现。

## 3. 目标架构

以下是目标架构，不代表代码已实现：

```text
Resource + ready body + page map
                |
                v
        Chunk / source mapping
                |
        +-------+--------+
        |                |
        v                v
  Embedding worker   LLM extraction worker
        |                |
        v                v
 Vector + FTS index   Entity / relation candidates
        |                |
        |          Entity resolution
        |                |
        |          Graph + evidence
        |                |
        |          Community summaries
        |                |
        +-------+--------+
                |
                v
 Query rewrite (optional)
                |
        +-------+--------+----------------+
        |                |                |
        v                v                v
 Vector / BM25      Entity + graph    Community search
 retrieval          multi-hop search  (global questions)
        |                |                |
        +----------------+----------------+
                         |
                   Rank fusion
                         |
                  Optional reranker
                         |
                         v
           Permission-filtered evidence
                         |
                         v
          Chunk snippets + Resource IDs
             + current-generation checks
```

核心原则：文本检索和图关系检索相互补充，图谱发现关联，原文证据支撑结论；任何图谱输出都不能替代来源正文。

## 4. 数据与索引设计建议

### 4.1 文本片段

Chunk 至少保留：

- Project ID、Resource ID、源 `assetGeneration`、Chunk ID 与序号；
- 正文片段、正文内 UTF-16 起止偏移；
- 可选 PDF 页码范围或页映射信息；
- Chunker 版本、创建时间。

切分以标题 / 段落边界优先，在长度超限时再拆分，并设置可配置的重叠区。不得只保存独立片段而丢失它与当前正文的位置关系。初版具体长度与重叠参数应由真实中文 / 英文资料集校准，不把某个通用 token 数直接当作所有语言的最优值。

### 4.2 图谱与证据

建议使用 Project-scoped 的关系数据模型：

- **Entity**：稳定 ID、规范名称、实体类型、描述；别名独立保存或以可校验结构保存。
- **Relation**：稳定 ID、起点 / 终点 Entity ID、规范化关系类型、描述。
- **Evidence**：实体提及或关系分别关联 Resource ID、源 asset generation、Chunk ID、原文片段 / 偏移、抽取模型与提示版本。
- **Index build state**：Resource ID、源代次、pipeline 版本、状态、attempt ID、错误分类与更新时间。
- **Community / summary**：社区算法版本、成员实体、摘要和摘要所依赖的证据 / 图谱版本。

实体与关系可以在同一 Project 内被多份 Resource 共同支持，但证据必须按来源独立记录。不得跨 Project 合并实体；也不得因为两个 Resource 提到相同实体，就让 Node 获得另一个无权 Resource 的证据文本。

删除或替换 Resource 时撤销其旧代次的 Evidence；只有仍有有效来源支持的实体 / 关系才能继续参与当前检索。共享关系的删除采用证据引用计数 / 有效证据查询语义，而不是删除一个 Resource 就级联删除整个关系网络。

## 5. 图谱构建链路

### 5.1 Chunking 与 Embedding

1. 只读取当前代次且正文状态为 ready 的正文；metadata_only、failed、pending 和 processing 不产生正文索引。
2. 按稳定的 Chunker 版本切分正文并保存位置映射。
3. 通过独立 Embedding Provider 对 Chunk 批量向量化；验证返回数量、维度、有限数值和模型标识。
4. 为关键词检索和向量检索分别建立可重建索引。模型或 Chunker 版本改变时，明确触发重建，不混用不同模型空间的向量。

### 5.2 LLM 实体 / 关系抽取

1. 对每个 Chunk 调用配置的通用 LLM，输出实体候选、关系候选和原文证据。
2. 优先使用现有 LLMService 的模型生成通道；通过结构化工具调用或 JSON 输出承载结果，随后进行严格运行时校验。Provider 不支持所需能力时应明确失败，不把未校验文本写入图谱。
3. 实体与关系抽取都必须引用输入 Chunk 中实际存在的证据；证据缺失、端点不在候选实体集合、类型不合法或输出超限时拒绝该次结果。
4. 将 LLM 输出视为不可信数据。文档中的指令不能改变抽取规则、调用权限、项目范围或工具能力。
5. 使用有界并发和有界重试；单个 Chunk 失败要留下可诊断状态，不导致整个 Project 的索引永久卡住。

### 5.3 实体消歧

- 先使用确定性规范化：空白、大小写、Unicode 与标点规则，以及已确认别名。
- 在同一 Project 内，以名称、实体类型和描述构建候选；只有证据足够时才合并。
- 模糊缩写或同名异义不能仅凭字符串相似度强行合并；首版允许保留重复节点，之后通过可追溯的合并操作纠正。
- 若使用 LLM 参与消歧，应只对受限候选集进行判断，输出仍需校验，并保留合并决策来源；不对所有实体做两两模型比较。

### 5.4 社区发现与摘要

为覆盖 GraphRAG 的全局问题能力，整体路线纳入图社区发现和社区摘要，而不只实现局部多跳检索。社区摘要是派生数据，必须绑定图谱 / 算法版本和来源证据；图变化后可增量更新或重建。社区摘要只能用于发现主题和缩小检索范围，最终事实性回答仍须尽可能返回原文证据。

## 6. 查询时的 GraphRAG

一次查询可组合以下路径，不要求每个问题都执行所有路径：

1. **查询增强（可选）**：将用户问题改写为关键词、实体线索或多个子查询；保留原始查询，不能让改写改变项目或权限范围。
2. **向量召回**：查找语义相似 Chunk。
3. **全文召回**：使用 BM25 / 全文索引补充关键词、专名和精确术语命中。
4. **图局部检索**：由命中实体扩展一到数跳关系，召回关联实体、关系及其证据 Chunk；跳数和候选量必须有界。
5. **全局检索**：对“整个项目的主要主题 / 共同趋势 / 主题关系”等问题，检索社区摘要，再回到支持摘要的实体、关系与原文。
6. **融合与重排**：先以 Reciprocal Rank Fusion（RRF）等不要求各路分数同尺度的算法融合候选；重排序器作为可替换环节，先以评测证明收益再决定默认启用。
7. **权限与新鲜度校验**：返回前再次验证 Resource 当前存在、调用主体有权访问、Evidence 对应当前有效代次。不可访问来源的标题、文本、图关系详情不得泄露。
8. **输出证据**：按 Resource 去重，但保留命中的 Chunk、关系路径和来源位置；结果应区分直接文本命中、图关系扩展和社区摘要线索。

图检索的候选扩展不等于证据成立。关系路径若没有当前有效 Evidence 支撑，不得作为可引用事实返回。

## 7. 存储与依赖选型

### 已建议

- **权威元数据与图谱存储：继续使用 SQLite。** 图节点、边、Evidence、构建状态和社区摘要采用关系表；首版不引入 Neo4j，避免增加部署和跨存储一致性负担。
- **LLM 抽取：复用现有 LLMService。** 使用独立的抽取任务配置，不创建另一套聊天 Runtime；抽取模型可与 Agent 模型相同，也可显式指定不同模型。
- **Embedding：新增最小独立 Provider 契约。** 首个实现候选是 OpenAI-compatible Embeddings API，允许配置 base URL / model / credentials，因此可连接兼容的云端 API 或本地服务；不假定现有 Chat Provider 已提供 Embedding。
- **向量索引：尚未最终冻结。** 优先验证 `sqlite-vec` 与当前 Node 24、内置 `node:sqlite`、Windows CI 及可恢复迁移的兼容性。若原生扩展的分发 / CI 风险过高，先用 SQLite 持久化向量并执行精确余弦检索作为正确性基线，评测数据规模后再引入 ANN 索引。不得在没有兼容性验证时将某个原生扩展写成既定依赖。
- **全文索引：评估 FTS5 的实际可用性和中英文检索效果。** 运行环境的 SQLite 编译选项与中文分词表现需实测；若不足，单独确定替代策略，不把英文 BM25 效果直接外推为中文效果。
- **重排序：采用可替换接口，但不默认新增专用模型依赖。** 首先比较 RRF 基线与一个可用 reranker 的实际指标和延迟，再决定默认策略。

### 暂不引入

- 不在首版直接依赖完整 Microsoft GraphRAG 框架；先吸收其实体 / 关系 / 社区摘要与 Local / Global Search 的架构思想，保留 Navo 对 Resource 权限、代次和生命周期的控制。
- 不训练专用抽取模型；先使用现有通用 LLM，并通过样本集测量质量与成本。
- 不同时接入多个向量数据库或多套图数据库。
- 不把社区摘要当成原文、不把模型自评置信度直接当作关系真实性，也不自动生成无来源的事实关系。

## 8. 生命周期、恢复与权限不变量

每个 Resource 的索引构建都绑定 `resourceId + assetGeneration + pipelineVersion`，领取任务使用独立 attempt ID。处理期间若源代次发生变化，迟到结果不得提交为当前索引。应用停机时取消未完成模型调用并等待受控清理；重启后对账 pending / processing / ready / failed 状态。默认不无限自动重试失败任务；显式重试必须可识别。

新一代索引应先在独立的构建版本中准备完毕，再原子切换为当前有效索引；不得让半套新图谱和旧图谱混合成为当前视图。原始 Resource 和正文始终是权威数据，所有 Chunk、Embedding、实体、关系、社区摘要均可从当前有效正文重新构建。

权限策略：

- 先在可信 Project / Resource 范围内构造候选，不能把全库检索结果直接返回后才过滤。
- 每条 Evidence 继承其 Resource 的当前可见性；共享实体不继承来源权限。
- 关系扩展可以用于内部排序，但在输出任何证据详情前必须检查每条来源的权限。
- 资料中的提示注入内容只作为被检索数据，不执行其中的指令。
- 不因资料索引更新、重建或完成而自动启动 Main / Node Turn。

## 9. 评测与验收建议

建立一组人工标注的项目资料和查询，覆盖中英文、专名、同义表达、跨文档多跳问题、全局主题问题、冲突证据、无答案问题、权限隔离及资料更新 / 删除。固定语料、查询、模型版本、索引版本和配置，形成可重复基线。

- 文本检索：Recall@K、MRR、nDCG@K。
- 图谱抽取：实体 / 关系 Precision、Recall、F1；证据有效率；实体错误合并率。
- GraphRAG：多跳答案所需证据召回率、关系路径证据覆盖率、全局主题覆盖率。
- 系统成本：每份资料构建的模型调用量 / token / 耗时、检索延迟、索引存储量、重建耗时。
- 正确性：替换 / 删除 / 重启后无旧代次泄漏；不同 Node 的检索结果不越权；索引失败不破坏原始资料；空正文、metadata_only 和处理失败状态正确区分。

至少比较：关键词基线、向量基线、混合文本检索、混合 + 图局部检索、加入社区 / Global Search 的完整方案。没有实测前不宣称 GraphRAG 必然优于普通 RAG。

## 10. 建议拆分的后续实现

以下是待审核的拆分建议，不代表已写入计划或已授权开始实施：

- **F13.3b：Chunk 与 Embedding 索引**——正文切分、来源位置、Embedding Provider、向量 / 全文索引和可重建状态。
- **F13.3c：实体关系抽取与图谱持久化**——结构化抽取、Schema 校验、实体消歧、Evidence、资源变化与图谱更新。
- **F13.3d：混合与图局部检索**——向量 / BM25 召回、实体命中、多跳扩展、RRF、可选重排序、片段与关系路径返回。
- **F13.3e：社区摘要与全局检索**——社区发现、摘要生成与版本维护、全局主题查询和原文证据回链。
- **F13.3f：检索公共 RPC 与 Electron Bridge**——分页搜索、结果变化、读取定位、错误 / 取消语义及实际 Bridge 验收；不开发 Renderer UI。
- **F13.3g：GraphRAG 端到端质量与恢复验收**——固定数据集、指标比较、替换 / 删除 / 重启 / 权限隔离与成本记录。

各 Step 的边界与计划编号须在本设计审核通过后统一落盘；本设计阶段不提前创建这些实施记录。

## 11. DeepSeek Harness 参考与适配边界

只读检查了以下公开源码：

- [`packages/llm/llm-deepseek/src/adapter.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm-deepseek/src/adapter.ts)：每次模型请求组合调用级 AbortSignal，并在取消或完成后执行传输清理。Navo 的图谱后台任务应复用同类的显式取消、限时与资源清理原则；不照搬其 DeepSeek Messages 专用协议。
- [`packages/core/tools/src/json-schema.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/tools/src/json-schema.ts)：对 JSON Schema 子集进行显式支持范围检查，并拒绝未知或不支持的 schema 形态。Navo 应对抽取输出做运行时结构校验，而不能只依赖 TypeScript 类型；不直接复制其完整工具 Schema 子系统。
- [`docs/subsystems/llm-streaming.md`](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/subsystems/llm-streaming.md)：模型内容通过稳定的分块协议传输。Navo 可以复用自身 `LLMService` 与流式结果收集，不为 GraphRAG 再造通用聊天 Runtime。

这些参考用于生命周期、结构校验和模型边界，不代表已验证任何 GraphRAG 实现效果。

## 12. 待审核事项

1. 是否认可“SQLite 作为图谱与权威元数据存储、Embedding 独立 Provider、向量后端先验证 sqlite-vec”的选型方向。
2. 是否认可完整路线覆盖 Local / Multi-hop Graph Search 与 Community / Global Search，并按后续子 Step 分期实现。
3. 是否认可首版抽取采用通用 LLM、严格 Schema 校验和可追溯 Evidence，不训练专用抽取模型。

本草案没有运行代码、模型或检索基准，也没有修改生产代码。待用户审核通过后，先收敛上述选型，再决定是否实施 F13.3b。
