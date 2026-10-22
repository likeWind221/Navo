# F13.3b：Chunk 与 Embedding 索引设计

日期：2026-10-22  
状态：🔄 设计讨论中；存储架构已由用户确认，Chunk 参数与实现细节待继续审核；未修改生产代码  
基线：master，F13.3a 设计方向已确认  
范围：只读审计与实施设计；本记录通过审核后，再给出编码提示词。

## 1. 目标与边界

本 Step 为 Navo 的项目资料建立可重建的 Chunk、Embedding 与关键词索引，为后续实体关系抽取和混合检索提供稳定输入。

本 Step 交付范围：

- 将当前代次且正文状态为 `ready` 的 Resource 正文切分为带来源位置的 Chunk。
- 新增独立 Embedding Provider 契约，支持 OpenAI-compatible Embeddings API 的批量请求。
- 将 Chunk、向量和索引构建状态持久化在现有 SQLite 中；先使用精确余弦相似度作为语义检索基线。
- 建立关键词检索基础，验证当前 Node 24 / `node:sqlite` 环境的 FTS5；若环境验证不通过，不得让 FTS5 的可选能力破坏数据库启动，应回报证据并提出轻量 fallback。
- 为后续语义 / 关键词检索提供内部服务接口与单测，不在本 Step 提供最终公共 RPC、Electron Bridge、Renderer UI 或 GraphRAG 图检索。
- 不实现实体关系抽取、消歧、多跳检索、社区摘要或全局检索。

## 2. 已有能力与限制

- 正文已由 `ContentProcessor` 写入 `resource_content`，记录 `source_asset_generation`、`ready / metadata_only / failed` 等状态，以及正文、PDF 页码映射和 extractor 版本。
- `ResourceContentStore.get/read` 会校验当前 Resource 与 `assetGeneration`。新索引必须沿用这个代次不变量，不能重新解析原始文件或索引过期正文。
- SQLite 当前 Schema 为 v5；新增表必须通过现有事务式迁移升级，保留 v1–v5 的迁移路径及旧库迁移测试。
- `LLMService` 是流式文本生成接口，不是 Embedding API；Embedding 应新增独立服务和 Provider 契约，不得把向量请求伪装成聊天请求。
- Navo 目标环境为 Node.js >= 24，内置 `node:sqlite`；不引入额外数据库服务或必须安装的原生扩展。

## 3. 总体流程

```text
Resource + current ready resource_content
                 |
                 v
       deterministic Chunker
                 |
                 v
   Chunk text + UTF-16 offsets + page map
                 |
                 v
      Embedding Provider (batched)
                 |
                 v
       validate vectors / dimension
                 |
                 v
     SQLite staged index generation
                 |
                 v
    atomic publish if source is current
                 |
         +-------+-------+
         |               |
         v               v
   exact cosine       FTS5 lexical
   similarity        index (if verified)
         |               |
         +-------+-------+
                 |
                 v
    internal candidate search service
```

原始 Resource 与 `resource_content` 仍是权威数据。Chunk、向量和全文索引均为派生数据，可从当前正文重建。

## 4. Chunking 设计

### 4.1 输入与切分原则

- 只接受当前 Resource 的 `resource_content.status = ready`，并核对 `source_asset_generation = Resource.assetGeneration`。
- 以 Markdown 标题、空行分隔的段落、句子边界为优先边界；单段超限时才按字符边界切分。
- 为中英文混合资料采用确定性的字符预算，不要求安装 Tokenizer。首版初始参数建议：目标长度约 1,200 个 Unicode 字符、重叠约 150 个字符；这只是可配置起点，须通过测试样例验证，不宣称等价于 Token 数。
- 切分前保留原正文的规范化结果，不对正文做不可逆改写。Chunk 文本必须能通过 `start_offset_utf16` / `end_offset_utf16` 在原正文中准确定位；偏移采用 JavaScript 字符串的 UTF-16 code unit 语义，与 PDF 页映射的现有口径一致。
- 对 PDF，将 Chunk 偏移区间与 `page_map_json` 区间求交，保存可定位的页码范围；跨页 Chunk 允许关联多个页码。对 Markdown / TXT，页码范围为空。
- 空白正文不生成 Chunk；不在此 Step 对扫描 PDF 做 OCR 或自行补造正文。
- Chunker 必须确定性：相同正文、相同参数和版本得到相同 Chunk 文本、顺序及偏移。版本变化必须能触发重建。

### 4.2 参数与标识

建议使用固定的 `chunker_version` 与明确配置项 `target_chars`、`overlap_chars`、`max_chars`。首版不必将所有参数做成用户可配置 UI，但需要在索引构建记录中保存参数 / 版本，以便复现和重建。Chunk ID 可使用 UUID，也可由 build ID + ordinal 构成；不得只用文本哈希作为唯一 ID，因为相同文本可能在同一 Resource 的不同位置重复出现。

## 5. Embedding Provider

### 5.1 契约

定义独立于 `LLMService` 的最小接口，例如：

- `embedMany({ model, inputs, signal })`：接收非空文本数组，返回与输入顺序一一对应的向量数组。
- Provider 标识、模型标识、维度和必要的能力信息明确可查。
- 配置通过现有安全配置机制提供 endpoint / model / credentials；密钥不得写入 SQLite、索引状态、错误日志或普通诊断。
- 首版采用 OpenAI-compatible `/embeddings` 请求形态；通过可注入 `fetch` 便于测试，不额外引入大型 SDK。兼容指请求与响应协议，不保证任意声称兼容的服务都完全遵循协议。
- 支持 AbortSignal、请求超时、有限重试与安全错误分类；取消不得被当成可重试的普通网络错误。
- API 请求必须按输入索引或响应的 `index` 字段还原顺序，检查每个输入均有且仅有一个向量。

### 5.2 向量校验

- 向量长度必须大于零且在同一构建代次内一致；每个元素必须是有限数值。
- 同一个索引 build 绑定明确的 provider、model 和 dimension；禁止将不同模型或不同维度的向量混用。
- 存储前转换为 Float32 表示并核验转换后的值仍有限；记录 dimension 与 encoding version。查询向量必须与当前索引的 provider / model / dimension 匹配，否则返回可诊断的配置不匹配错误。
- 首版使用精确余弦相似度排序。零范数向量不能参与正常相似度排序，应拒绝或标记为无效，不得返回 NaN 排序结果。
- 批次按输入条数、单条字符上限与请求体大小共同约束；首版建议默认每批 32 个 Chunk，设置硬上限并允许配置。若 API 返回上下文超限或批次验证失败，拆分批次重试；不无限重试、不重复提交已经成功且已持久化的批次。

### 5.3 隐私说明

Chunk 正文会发送到用户配置的 Embedding API。调用前不需要额外弹窗，但配置说明与后续设置 UI 必须明确该数据流；API Key 仅保存在既有安全配置位置，不进入索引库或 Resource 元数据。若用户没有配置 Embedding Provider，正文提取仍应正常工作，索引状态应明确显示为等待配置 / 可重试，而不是把 Resource 正文标记为失败。

## 6. SQLite 持久化与索引代次

### 6.1 建议的数据模型

在不预先绑定最终表名的前提下，建议引入三类数据：

1. **索引构建记录**：project / resource、源 `assetGeneration`、pipeline / chunker 版本、provider / model / dimension、状态、attempt ID、错误码、时间戳。至少区分 `pending / processing / ready / failed`，必要时用单独的 active pointer 标识当前发布版本。
2. **Chunk 记录**：build ID、ordinal、文本、UTF-16 起止偏移、页码范围、chunker 版本。
3. **Embedding 记录**：build ID + chunk ID、向量 BLOB（Float32 little-endian）、dimension / encoding metadata。避免把向量存成 JSON 浮点数组，以减少空间与解析开销；不要使用不透明 BLOB 而不保存可校验的维度和编码版本。

可按需要增加 FTS5 虚拟表，以 Chunk ID 为索引键；FTS 记录必须与当前发布的 Chunk 同步。表名、索引和具体 DDL 由实现者结合当前 storage 事务封装确定，并写入实施记录。

### 6.2 原子发布

- 每次构建使用独立 build ID，在 staging 状态写入 Chunk 与 Embedding；不在外部 API 调用期间持有 SQLite 事务。
- 全部 Chunk 与向量校验成功后，在一个短 SQLite 事务内重新核对 Resource 当前存在、当前 `assetGeneration` 与 build 的源代次一致，然后将 build 标记 ready 并切换 active pointer。
- 若源代次在处理期间变化、Resource 被删除、任务取消或结果不完整，不得发布该 build；迟到的 API 响应不能覆盖新版本。
- 旧索引在新版本原子发布后清理；如果构建失败，保留旧的有效索引（若其来源仍是当前代次），并记录失败状态。不能让半套新索引与旧索引混合参与搜索。
- 删除 Resource 时，在现有生命周期事务内删除或失效关联索引；若清理大数据不适合放入删除事务，可先原子标记不可检索，再异步清理孤儿数据。无论如何，删除提交后检索不能返回其旧 Chunk。

### 6.3 恢复与重建

- 启动时对账索引构建记录：遗留 processing 重置为 pending 或 failed（按现有恢复惯例选择）；只自动恢复可安全重做的工作，不无限重试持久化失败。
- 以 `projectId + resourceId + assetGeneration + chunkerVersion + embedding provider/model` 识别所需索引版本。正文代次、Chunker 或 Embedding 模型变化时需要新建索引，不能原位混写。
- 已完成的 Embedding 批次应有可识别的持久化状态，重启后跳过已验证的批次，避免无意义地重复计费；但最终发布仍必须重新验证完整性与当前源代次。
- 原始正文始终保留；向量索引损坏或被清理后可以重新生成，不得反向影响 Resource 资产和 `resource_content`。

## 7. 关键词索引与语义检索基线

### 7.1 FTS5

- 在支持的 Node 24 / SQLite 环境中验证 FTS5 是否可创建、写入、删除与重建；测试 `trusted_schema = OFF`、WAL 和现有迁移路径下的真实行为。
- FTS5 的默认 tokenizer 对中文连续文本可能无法获得理想召回，必须用中英文混合样本验证。首版不为了中文检索直接引入大型外部分词依赖。
- 如果 FTS5 不可用，实施者应在冻结 DDL 前报告并提出最小 fallback；不得悄悄将全文检索降级成未经测试的 LIKE 查询，也不得令现有 v5 数据库无法启动。
- 查询结果只允许从当前 active build 召回，并在返回前核对 Resource 访问权限与代次。

### 7.2 精确向量检索

- 首版扫描当前查询范围内的有效向量，使用点积 / 范数计算余弦相似度并取 Top-K；不得先载入所有项目 / 所有 Resource 的向量再做无界内存分配。
- 先用 SQL 限定项目、active build、模型与维度，再分批读取向量并维护有界 Top-K；返回的分数、排序和 tie-breaker 必须确定性。
- 语义查询与关键词查询分别返回 Chunk 候选及 rank / score；后续 Step 通过 RRF 等方法融合。本 Step 不实现图关系扩展和最终 Agent 上下文拼装。

## 8. 内部接口边界

本 Step 只提供内部服务，不发布公共 RPC：

- Chunker：纯函数 / 可独立单测的文本切分与来源位置映射。
- EmbeddingProvider：批量请求和向量校验。
- ResourceIndexProcessor：按 Resource 当前代次排队、领取、执行、取消、重试、恢复和发布索引。
- ResourceIndexStore：在 StorageService 事务内管理 build、Chunk、Embedding 与 active pointer。
- IndexSearch：提供内部语义 Top-K 与关键词 Top-K 候选，为后续混合检索和 GraphRAG 提供基础。
- Service 在 `app.ts` 中按现有 Cordis 生命周期装配；Resource 正文提交后以内部事件触发索引，不在 Resource 提交事务中调用外部 API。

具体类型、错误码、Provider 配置接入点和是否采用独立的 `EmbeddingService` 名称，以当前配置与 Service 装配审计为准；不得把 Embedding 逻辑放进 `LLMService` 的流式聊天协议。

## 9. 测试与验收

### 9.1 Chunker

- 中英文、Markdown 标题 / 段落、超长段落、重叠区、空白正文、emoji / surrogate pair、连续换行。
- 每个 Chunk 的 UTF-16 偏移必须精确切回原正文；PDF 页映射应正确覆盖跨页 Chunk，空白页不导致后续页码错位。
- 同输入与配置重复运行结果完全一致；chunker version 变化可触发重建。

### 9.2 Embedding Provider

- 模拟标准成功响应、乱序 index、缺失向量、维度不一致、NaN / Infinity、空向量、HTTP 401 / 429 / 5xx、超时、取消、坏 JSON 与响应超限。
- 验证批次拆分、有限重试、响应排序恢复、密钥不进入日志、取消后资源清理。
- 不要求首轮测试真实付费 API；通过可注入 fetch 的 mock 测试协议与错误语义。真实 API smoke test 如需执行，应由用户显式配置并单独运行。

### 9.3 SQLite / 生命周期

- 从 v1、v2、v3、v4、v5 迁移到新版本，失败回滚与既有表数据保持不变。
- `ready / metadata_only / failed` 正文准入；Resource 替换、删除、索引过程中代次变化、重复通知、取消、重启恢复、数据库关闭等待。
- 新索引成功后原子切换；失败 / 中断不能暴露部分索引；旧索引不应在新 build 成功发布前提前删除。
- FTS5 可用性、增删改同步、重建及中英文召回基线。
- 精确余弦与独立参考实现的数值一致性；零范数、维度不匹配、空索引和有界 Top-K。
- 越权、旧代次和已删除 Resource 的 Chunk / 文本 / 分数均不得泄露。

### 9.4 质量与成本记录

建立小型固定语料和查询集，至少覆盖中英文、专名、同义表达、短查询、无结果查询。记录 Recall@K、MRR、nDCG@K、索引构建耗时、Embedding 请求数 / 输入数、重试数、向量存储量与查询延迟。当前没有实测前，不宣称特定 Chunk 参数或精确向量检索适用于任意大规模资料库。

## 10. 本 Step 明确不做

- 不实现实体与关系抽取、实体消歧、图谱关系表、多跳检索或社区摘要。
- 不引入 `sqlite-vec`、LanceDB、Qdrant、Neo4j 或本地模型下载。
- 不实现公共 RPC、Electron Bridge、Renderer UI 或最终搜索体验。
- 不自动启动 Agent，不改变现有 Resource 权限和 Human Gate。
- 不调用真实付费 Embedding API 作为 CI 必需步骤。
- 不修改原始 Resource 资产和正文提取规则。

## 11. 已确认决策与待审核事项

### 已确认

1. **存储全部使用 SQLite。** Chunk、Embedding 向量、索引构建状态和关键词索引均在现有 SQLite 持久化体系内管理；不引入 LanceDB、sqlite-vec、Qdrant、Neo4j 或其他独立数据库 / 原生扩展。
2. **向量检索先用精确相似度基线。** 由 Navo 的存储与检索层读取 SQLite 中的 Float32 BLOB，计算余弦相似度并返回 Top-K。向量计算可以使用经过评估的轻量数学工具，但不引入另一个向量数据库；是否需要额外数学依赖以实现审查为准。
3. **Embedding 通过独立 API Provider 批量调用**，不内置或自动安装本地模型。
4. **本 Step 只建设 Chunk / Embedding / 关键词索引及内部候选检索**，不提前实现图谱构建、多跳检索、公共 RPC 或 Renderer UI。

### 仍待审核

1. Chunk 按标题、段落和句子边界优先切分，超限后逐级降级到子句边界和安全字符边界；初始目标约 1,200 字符、重叠约 150 字符是否作为可配置起点，需结合切分规则样例一起确认。
2. 是否采用 Float32 BLOB + 独立 build ID / active pointer 的原子发布模型；该方案是当前推荐设计。
3. Embedding API 每批默认 32 个输入是否合适，以及批次上限、拆批重试与部分成功状态的具体规则。
4. FTS5 在目标 Node / SQLite 环境的可用性与中文检索方案仍需实测，不能仅凭设计假定其中文效果。

本文仅为设计草案，尚未修改生产代码，尚未执行 typecheck、测试或真实 API 调用。
