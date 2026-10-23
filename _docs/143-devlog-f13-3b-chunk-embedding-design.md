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

### 4.1 输入、结构识别与切分规则

#### 输入约束

- 只接受当前 Resource 的 `resource_content.status = ready`，并核对 `source_asset_generation = Resource.assetGeneration`。
- 以正文提取阶段保存的文本为切分输入；不重新解析原始文件，不在本 Step 重新清洗或不可逆规范化正文。所有起止位置都对应这份已持久化正文。
- 切分长度按 Unicode code point 计数，原文偏移继续使用 JavaScript 字符串的 UTF-16 code unit 语义，以兼容现有正文 / PDF 页码映射。实现中必须显式转换并测试 emoji 等代理对字符，不能混用两种计数口径。
- 空白正文不生成 Chunk。扫描 PDF 没有可用提取正文时，不生成虚构内容，也不在本 Step 引入 OCR。

#### 结构块识别

按输入格式采用轻量、确定性的规则，不引入 NLP 模型：

1. **Markdown 标题**：识别行首的 `#` 至 `######`，且后接空格或行尾；维护标题栈，遇到同级或更高级标题时弹出旧标题。标题作为结构块和 Chunk 的上下文元数据，不要求每个标题单独生成一个 Chunk。
2. **Markdown 代码围栏**：识别常见的 `\x60\x60\x60` 或 `~~~` 围栏及其闭合标记。围栏内部不执行句末标点切分；代码块先整体作为结构块处理，超长时优先按换行切分，再对超长单行执行安全字符切分。
3. **Markdown 表格**：识别连续的表格行和分隔行。表格优先按行边界切分；如果跨 Chunk，原始 `text` 保存连续原文区间，表头可作为 `embeddingText` 的上下文前缀，不伪造原文偏移。
4. **Markdown 列表**：识别常见无序 / 有序列表标记及缩进续行，优先把完整列表项视为结构单元；超长列表项再按句子 / 子句规则拆分。
5. **Markdown / TXT / 提取后的 PDF 普通段落**：优先以空行分隔段落；对 PDF 或 TXT 中仅有单换行的文本，不把每一行都视为独立段落，而是按已有换行和标点启发式合并连续行。不得跨越明确的标题、空行、代码围栏或表格边界合并。
6. **结构信息不足时**：退化为连续文本块，并使用后续的句子 / 子句 / 字符规则。首版不承诺从纯文本中完美还原原始排版。

以上识别器应输出带类型、原文 UTF-16 起止偏移、标题路径的结构块列表。结构块必须按原文顺序、不重叠地覆盖可切分正文；若某类语法无法可靠识别，应采用保守 fallback，不能丢弃文本。

#### 长度参数

- `target_chars = 1200`：软目标长度，用于决定何时结束当前 Chunk。
- `max_chars = 1600`：硬上限；普通正文 Chunk 不得超过该值。若原子单元自身超过上限，必须继续拆分。
- `overlap_chars = 150`：相邻 Chunk 的重叠目标，不是强制精确值。优先回退到完整句子或结构边界，因此实际重叠可略大 / 略小；不能为凑重叠而突破硬上限或产生无限循环。
- 以上长度按 Unicode code point 计算，参数作为 Chunker 配置和版本的一部分保存；UTF-16 偏移单独维护。

#### 组合与超长块切分算法

按原文顺序执行以下确定性步骤：

1. **完整结构块优先组合**：从空 Chunk 开始依次加入结构块。若加入下一个结构块后总长度仍不超过 `target_chars`，就继续累积；若会超出目标，则在当前结构块之前结束当前 Chunk，再从新块开始。标题路径作为元数据保留，并用于构造 Embedding 输入，不必重复写进原文片段。
2. **单个结构块超过软目标**：若当前 Chunk 为空且结构块长度超过 `target_chars`，对该块递归细分；不能因为它是单个段落、列表或代码块就让 Chunk 无界增长。
3. **普通段落 / 列表项切分**：先用句末标点识别候选句子边界，优先把完整句子累积到不超过软目标的范围。中文主要考虑 `。！？`，英文考虑 `.!?`；句号候选需排除常见小数、URL / 域名、文件路径和缩写误判。首版使用可测试的启发式规则，不引入完整语法解析器。
4. **句子仍过长**：优先在分号、冒号等子句边界切分，再考虑逗号等较弱边界；每次选择不超过软目标且最靠近目标的合法边界。若单个子句仍超过硬上限，继续细分。
5. **代码块切分**：不按普通自然语言标点拆分。先按换行 / 完整代码行切分；单行超过硬上限时再按安全 Unicode 字符边界切分。保留代码围栏 / 语言信息作为上下文元数据，不能将语法字符当作自然语言句末。
6. **表格切分**：优先按表格行边界切分；表头在需要时加入 `embeddingText` 前缀以增强行内容的语义，但 `text` 和原文偏移仍只表示实际原文连续区间。超长单行或单元格最后按安全字符边界处理。
7. **安全字符兜底**：找不到合适结构边界时，按 Unicode code point 边界切分，确保 Chunk 不超过硬上限。不得直接按 UTF-16 code unit 中间位置切开代理对。
8. **进度保证**：每次切分必须消费至少一个字符或一个结构单元；对无法识别的输入采用安全字符 fallback，确保不会死循环，也不会静默丢失文本。

#### 重叠与上下文

- 完成基础切分后，再计算相邻 Chunk 的重叠：从前一 Chunk 尾部向前寻找最接近 `overlap_chars` 的完整句子边界；若找不到，再选择子句边界，最后才按安全字符边界回退。
- 重叠不能跨越不同 Resource，也不能跨越被识别为独立的代码 / 表格结构而制造无效上下文。对于代码和表格，优先保留必要的结构前缀（例如代码语言标识、表头）作为 `embeddingText` 上下文，而不是机械复制任意 150 个字符。
- 每个 Chunk 至少记录原始 `text`、`start_offset_utf16`、`end_offset_utf16`、标题路径 / 结构类型及 ordinal。重叠意味着不同 Chunk 的原文区间可以相交，但按 ordinal 排列后必须保持原文顺序且不得遗漏正文。
- `embeddingText` 是派生输入，可在原文 `text` 前加入标题路径、表头或代码语言等上下文；它不用于原文定位，不能替代 `text`，也不能把前缀算入原文偏移。
- 对 PDF，将每个 Chunk 的 UTF-16 原文区间与既有 `page_map_json` 区间求交，记录覆盖页码；跨页 Chunk 可关联多个页码。标题路径等元数据不改变页码映射。

#### 原文覆盖与确定性

- 对无重叠的基础切分结果，所有 Chunk 的原文区间必须按顺序完整覆盖应索引正文，不得遗漏或重排字符；应用重叠后，允许相邻区间相交，但不得出现未被任何 Chunk 覆盖的正文空洞。
- 相同正文、Chunker 版本与参数必须生成相同的结构块、Chunk 顺序、文本、标题路径和偏移。
- 需要为 Markdown / TXT / PDF 提取正文分别建立固定样例，验证结构识别、切割点、偏移和页码映射。仅断言 Chunk 数量不足以验收切分算法。

## 5. Embedding Provider

### 5.1 契约

定义独立于 `LLMService` 的最小接口，例如：

- `embedMany({ model, inputs, signal })`：接收非空文本数组，返回与输入顺序一一对应的向量数组。
- Provider 标识、模型标识、维度和必要的能力信息明确可查。
- 配置通过现有安全配置机制提供 endpoint / model / credentials；密钥不得写入 SQLite、索引状态、错误日志或普通诊断。
- 首版目标为用户自建的 Qwen3-Embedding-0.6B 推理服务器，建议通过 vLLM 暴露 OpenAI-compatible `POST /v1/embeddings`；Navo 仅作为 API 客户端，不负责下载或启动模型。使用可注入 `fetch` 便于测试，不额外引入大型 SDK。
- 默认模型 ID 为 `Qwen/Qwen3-Embedding-0.6B`，固定输出维度 1024，不启用自定义降维。索引构建记录模型 ID / 可用的服务端模型版本；模型版本变化时允许重建。
- 文档侧使用 Chunk 的正文，可在 `embeddingText` 中附加标题路径；查询侧使用版本化的检索任务指令模板。不得把查询指令混入文档正文；输入模板版本变化时需重建对应向量。
- 支持 AbortSignal、请求超时、有限重试与安全错误分类；取消不得被当成可重试的普通网络错误。
- API 请求必须按输入索引或响应的 `index` 字段还原顺序，检查每个输入均有且仅有一个向量。

### 5.2 向量校验

- 向量长度必须大于零且在同一构建代次内一致；每个元素必须是有限数值。
- 同一个索引 build 绑定明确的 provider、model 和 dimension；禁止将不同模型或不同维度的向量混用。
- 文档向量和查询向量使用相同的 L2 归一化规则，随后编码为 Float32 little-endian BLOB；记录 dimension 与 encoding version。查询向量必须与当前索引的 provider / model / dimension / 输入模板版本匹配，否则返回可诊断的配置不匹配错误。零范数或非有限向量拒绝入库。
- 首版对归一化向量使用点积计算余弦相似度，并执行精确 Top-K 排序。
- **批量默认值（Qwen3-Embedding-0.6B 首版）**：默认每批 16 个 Chunk，硬上限 32 个；同一索引构建最多同时请求 1 个批次。运行策略应可配置，不作为模型协议常量。实际批次还受单条输入 Token 上限、服务端限制、请求体字节数与输入条数共同约束；单条输入必须在请求前验证。服务端明确报告整批超限时将批次对半拆分；单条仍超限则报错，不静默截断。
- **请求与重试**：单次请求超时 60 秒，最多 3 次尝试（含首次）；网络错误、超时、HTTP 408 / 429 / 可恢复的 5xx 使用指数退避（约 1 秒、2 秒并加入随机抖动），429 优先遵守 `Retry-After`。401 / 403、模型不存在及配置错误不自动重试。取消立即停止后续派发并尽可能中止在途请求。
- **响应和落盘**：按响应 `index` 恢复输入顺序，校验数量、索引唯一性、1024 维及所有元素为有限数值。缺项、重复索引、维度错误或格式异常时整批拒绝。校验通过后，在单个 SQLite 事务内写入整批向量并标记批次成功；已成功持久化的批次恢复时跳过。若 API 已完成但客户端在写入前崩溃，仍可能重发，不承诺跨 HTTP 与 SQLite 的 exactly-once。

### 5.3 隐私说明

Chunk 正文会发送到用户配置的 Embedding API。调用前不需要额外弹窗，但配置说明与后续设置 UI 必须明确该数据流；API Key 仅保存在既有安全配置位置，不进入索引库或 Resource 元数据。若用户没有配置 Embedding Provider，正文提取仍应正常工作，索引状态应明确显示为等待配置 / 可重试，而不是把 Resource 正文标记为失败。

## 6. SQLite 持久化与索引代次

### 6.1 建议的数据模型

在不预先绑定最终表名的前提下，建议引入三类数据：

1. **索引构建记录**：project / resource、源 `assetGeneration`、pipeline / chunker 版本、provider / model / 可用的模型版本、dimension、文档 / 查询输入模板版本、encoding version、状态、attempt ID、错误码和时间戳。至少区分 `pending / processing / ready / failed`。
2. **批次记录**：build ID、稳定的批次标识 / 输入范围、输入指纹、状态、尝试次数、最后错误类别和时间戳。批次向量与成功状态必须在同一事务提交。
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

- 启动时对账索引构建记录：遗留 processing 批次恢复为 pending，并重新核对已成功批次的向量数量、维度与输入指纹；只自动恢复可安全重做的工作，不无限重试持久化失败。
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

1. Chunk 规则已按用户确认细化：结构块优先、句子 / 子句逐级拆分、字符安全兜底；软目标 1,200、硬上限 1,600、重叠目标 150，按 Unicode code point 计长、按 UTF-16 code unit 保存原文偏移。后续实现必须通过切割点和原文覆盖测试。
2. Float32 BLOB + 独立 build ID / active pointer 的原子发布模型仍为推荐方案，待设计收口时一并冻结。
3. Embedding 批量与恢复策略已由用户确认：Qwen3-Embedding-0.6B（建议 vLLM API）、默认每批 16 条、硬上限 32 条、单构建并发 1、60 秒请求超时、最多 3 次尝试、指数退避并遵守 Retry-After、响应整批校验后事务落盘；重启跳过已校验批次，取消停止后续工作。具体服务端 Token / 请求体限制仍需部署后验证。
4. FTS5 在目标 Node / SQLite 环境的可用性与中文检索方案仍需实测，不能仅凭设计假定其中文效果。

Embedding 批量调用与失败恢复方案已由用户确认；FTS5 的环境兼容性与中文检索策略仍待审核。本文仍为设计稿，尚未修改生产代码，尚未执行 typecheck、测试或真实 API 调用。
