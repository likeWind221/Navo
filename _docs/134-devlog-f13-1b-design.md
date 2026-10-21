# F13.1b 正文提取与处理恢复：技术设计草案

日期：2026-10-20
基线：`master` / PR #82 合并后，commit `d340e18b202017ed294d10bfbc48de23137c3c18`
状态：设计草案 v2，已根据首轮只读审核修订，待复审；未实施
范围：仅 F13.1b 正文提取、正文持久化、处理状态与恢复。不修改生产代码。

## 1. 目标与非目标

### 目标

- 将已保存的 Markdown、TXT 和可提取文本的 PDF 转换为规范化正文。
- 将正文、处理状态、原始文件代次及 PDF 页码映射持久化到 SQLite。
- 区分原始文件保存成功、正文处理成功和后续检索索引建立成功。
- 在失败、替换、删除、重复触发、任务交错及 Host 重启后，保持正文有效性和恢复能力。
- 为 F13.3 提供稳定的正文读取输入，并保留正文片段到 Resource / PDF 页码的来源映射。

### 非目标

- 不实现 Chunk 切分、Embedding、向量数据库、关键词索引、重排或召回算法（F13.3）。
- 不决定 Agent 何时检索、检索预算或按需阅读（F13.4）。
- 不实现 User owner、用户资料导入、用户管理入口或公共 RPC（F13.1c）。
- 不实现扫描 PDF 的 OCR、复杂表格 / 公式 / 图片理解。
- 不重构 Resource 事件投影为关系表，不改变 F13.1a 的原始资产生命周期内核。
- 不新增独立任务表、常驻任务服务或通用队列框架。

## 2. 当前代码基线与复用边界

审计基于 PR #82 合并后的 `master`，未发现现有正文持久化表、统一正文提取器或正文任务恢复机制。

- `src/resource/model.ts`、`src/resource/projector.ts` 和 `src/resource/store.ts`：Resource 当前状态由事件历史投影得到。正文内容不写入 Resource 事件，也不改变现有 `revision` 语义。
- `src/resource/service.ts`：复用 Resource 查询、权限检查及固定原始资产代次的读取入口。
- `src/resource/lifecycle.ts`、`src/resource/assets.ts`：继续作为原始文件创建、替换、删除、读取租约及生命周期恢复的权威实现。
- `src/storage/database.ts`、`src/storage/schema.ts`、`src/storage/operations.ts`：复用 SQLite 事务与迁移基础；正文处理状态不复用 `resource_file_operations`。
- `src/app.ts`：在现有 Host 启动恢复流程中接入正文对账与未完成任务恢复。
- `src/tools/builtins/file/read.ts`：当前是 Agent 分段阅读工具，不作为完整正文提取实现。
- 现有 HTML-to-Markdown 的 `turndown` 路径只服务网络抓取，不视为通用资料提取器。

当前 Schema 为 v3。实现时新增 v3→v4 迁移，并保留 v1→v2→v3→v4 的既有迁移链。

## 2.1 DeepSeek Harness 只读参考

按仓库约定只读检查了 `deepseek-ai/deepseek-harness/packages/document/office-to-pdf/src/queue.ts`。该队列采用有界输入准入、显式 AbortController、真实任务完成后才释放处理容量，并在 dispose 时取消任务并等待实际任务与清理结束。

F13.1b 只借鉴这些生命周期原则：限制并发 / 输入规模、将取消传入解析器、只有解析实际结束后才释放处理槽位、Host 关闭时等待或协调任务结束。它不需要照搬 Harness 的优先级队列、共享读者、结果缓存、Office 转 PDF 管线或通用转换服务；Navo 首版由单个正文处理协调器串行处理任务即可。PDF.js 的逐页文本读取仍是本阶段自己的适配器。

## 3. 架构与职责

```text
ResourceLifecycle (existing)
  | successful create / replace / delete
  v
ContentProcessor (new, lightweight in-process coordinator)
  |                         ^
  | read fixed generation   | startup reconciliation
  v                         |
ContentExtractorRegistry    Host startup recovery
  |                         |
  +-- Markdown / TXT        |
  +-- PDF.js                |
  |                         |
  v                         |
SQLite resource_content <---+
  |
  v
F13.3 consumes current ready body (future; not implemented here)
```

职责边界：

- **ContentExtractor**：只负责从给定原始文件字节读取正文；不访问 SQLite、不改变 Resource、不调度任务。
- **ContentProcessor**：安排任务、领取处理权、协调取消、调用提取器，并提交处理结果。
- **ResourceContentStore**：通过现有 Storage 事务接口读写正文记录、领取状态和提交结果。
- **Host recovery**：先完成现有 Resource / 原始资产恢复，再对账正文记录并恢复未完成处理。
- **ResourceService / ResourceLifecycle**：仍是原始资料身份、权限和代次的权威来源。

首版用轻量的进程内调度器串行处理正文任务，以限制 PDF 解析的内存占用；不引入通用队列框架。原始文件发布成功不能依赖正文提取成功，也不能因正文处理失败回滚已提交的原始资产。

## 4. 数据模型

### 4.1 单表方案

新增 SQLite 表 `resource_content`。每个 Resource 最多保留一条当前正文记录，不保留旧正文历史，也不新增独立任务表。

建议字段与正式 DDL：

| 字段 | 约束与用途 |
|---|---|
| `project_id` | 非空 Project ID；用于项目隔离、按项目对账和清理 |
| `resource_id` | 非空 Resource ID；与 `project_id` 组成复合主键。Resource 不是 SQL 主表，因此不声明指向不存在表的外键 |
| `source_asset_generation` | 正整数；正文对应的原始文件代次 |
| `status` | `pending` / `processing` / `ready` / `metadata_only` / `failed` |
| `body` | 完整规范化正文；仅 `ready` 状态允许非空 |
| `page_map_json` | PDF 页码到正文字符区间的映射；非 PDF 可为空 |
| `extractor_version` | 生成当前正文的提取器标识 / 版本 |
| `processing_attempt_id` | 当前处理尝试 ID；非处理中状态为空 |
| `error_code` | 稳定的机器可读错误码 |
| `error_message` | 有长度上限、可供诊断的安全错误摘要 |
| `updated_at` | UTC 更新时间 |

正式 DDL 在 `src/storage/schema.ts` 中作为 Schema v4 的一部分维护，并使用仓库现有的 SQLite `STRICT` 表约定：

```sql
CREATE TABLE resource_content (
  project_id TEXT NOT NULL CHECK (length(trim(project_id)) > 0),
  resource_id TEXT NOT NULL CHECK (length(trim(resource_id)) > 0),
  source_asset_generation INTEGER NOT NULL CHECK (source_asset_generation >= 1),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'ready', 'metadata_only', 'failed')),
  body TEXT,
  page_map_json TEXT CHECK (
    page_map_json IS NULL OR
    (json_valid(page_map_json) AND json_type(page_map_json) = 'array')
  ),
  extractor_version TEXT,
  processing_attempt_id TEXT,
  error_code TEXT,
  error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 1000),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, resource_id),
  CHECK (
    (status = 'ready' AND body IS NOT NULL AND length(trim(body)) > 0 AND extractor_version IS NOT NULL)
    OR (status != 'ready' AND body IS NULL)
  ),
  CHECK (
    (status = 'processing' AND processing_attempt_id IS NOT NULL AND length(trim(processing_attempt_id)) > 0)
    OR (status != 'processing' AND processing_attempt_id IS NULL)
  ),
  CHECK (status != 'failed' OR error_code IS NOT NULL),
  CHECK (status = 'ready' OR (page_map_json IS NULL AND extractor_version IS NULL))
) STRICT;
CREATE INDEX resource_content_by_project_status
  ON resource_content (project_id, status, updated_at);
```

`StorageTransaction` 需增加项目范围明确的正文记录访问方法（读取、按项目列举、写入 / 更新、删除），并确保所有查询都同时使用 `project_id` 和 `resource_id`。

不增加 `attempt_count`：首版不按尝试次数自动退避或改变任务策略，失败信息与更新时间用于基本诊断。失败任务通过显式重试触发；Host 重启恢复的是中断中的任务，不是无限自动重试所有失败项。

`processing_attempt_id` 是一次处理尝试的唯一标识，不是大模型文本 Token。领取任务时生成新的 UUID；提交时要求该 ID 仍匹配，阻止已取消或过期的旧任务提交结果。

### 4.2 数据约束

- `(project_id, resource_id)` 为复合主键；所有读取、更新、删除均须同时带上 Project ID，禁止只凭 Resource ID 跨项目访问正文。
- `source_asset_generation` 必须为正整数。
- `ready` 必须同时满足正文存在且规范化后非空；非 `ready` 状态的 `body` 为 NULL。
- `processing` 必须持有非空 `processing_attempt_id`；其他状态清空该字段。
- `metadata_only` 和 `failed` 不保存可用正文。
- 建立 `(project_id, status, updated_at)` 索引，支持项目范围内的启动对账与待处理记录查询。
- 因没有 Resource SQL 主表，不能声明指向 Resource 的外键；删除流程在同一 SQLite 事务内清理正文记录，启动反向对账作为异常残留的兜底。
- 不使用 Resource 的 `revision` 判定正文有效性：名称、描述、权限变更会改变 revision，却不改变原始文件内容。正文有效性由 Resource 当前状态与 `assetGeneration` 决定。

### 4.3 PDF 页码映射

正文保存为一个规范化字符串；PDF 额外保存页码映射，例如：

```json
[
  { "page": 1, "start": 0, "end": 812 },
  { "page": 2, "start": 814, "end": 1560 }
]
```

- 区间采用 `[start, end)`。
- 偏移量以 JavaScript 字符串 UTF-16 code unit 为单位，与后续 JS 字符串切片一致。
- 每页先完成确定性的单页规范化，再追加固定的 `\n\n` 页面分隔符并计算该页区间；偏移量必须对应最终持久化正文。拼接完成后禁止再执行会改变字符数量的全局规范化。
- 空白页可记录空区间，避免丢失原始页码关系。
- F13.3 可据此将 Chunk 的正文区间映射回一个或多个 PDF 页码；F13.1b 不负责 Chunk 切分。

## 5. 状态机

```text
missing row / new asset generation
              |
              v
           pending
              |
         atomic claim
              v
          processing
           /   |    \
          /    |     \
         v     v      v
       ready metadata_only failed
                       |
                explicit retry
                       |
                       v
                    pending
```

状态语义：

- `pending`：当前代次等待处理。
- `processing`：已有一个持有 `processing_attempt_id` 的尝试正在处理。
- `ready`：正文非空且已与状态在同一事务中持久化；只表示正文可用，不表示索引已建立。
- `metadata_only`：文件格式不在首版正文提取支持范围内，正文不可用，但原文件和文件元信息仍保留。
- `failed`：支持的格式发生损坏、提取错误、正文为空或超过限制等处理失败。空正文一律记为 `failed / empty_content`，包括扫描 PDF 没有可提取文字的情况。

替换为新代次时，记录切换到新 `source_asset_generation`、清空旧正文和页码映射、清除旧尝试 ID，并回到 `pending`。在记录更新之前，读取方也必须通过代次校验使旧正文立即失效。

不新增 `cancelled` 状态，但必须区分 Host 停机中断与运行期失败：

- **Host 优雅关闭**：停止领取新任务，向当前处理器发出专用的 shutdown signal；在能成功提交状态的前提下，将当前尝试撤销并重置为 `pending`，随后等待 PDF.js 清理完成。关闭流程不得再次 drain 队列。
- **Host 被强制终止**：数据库中可能残留 `processing`；下次启动确认旧 Host 已退出并取得单实例锁后，将其恢复为 `pending`。
- **运行期取消、超时、超限或解析失败**：转为 `failed`，记录稳定错误码（例如 `cancelled`、`timeout`、`content_limit_exceeded`、`pdf_parse_failed`），不自动重新入队；只有显式重试才回到 `pending`。
- **状态写入本身失败**：不得在内存中无限立即重试；停止该任务的自动重入队并记录诊断，遗留状态由后续启动对账恢复。

首版不提供独立的用户取消 UI；上述运行期取消语义约束内部 AbortSignal 与未来调用方。

## 6. 处理流程、触发与恢复

### 6.1 创建与替换

1. 现有 ResourceLifecycle 完成原始文件操作和 Resource 事件提交。
2. 成功后为当前代次创建或更新 `resource_content` 的 `pending` 记录，并安排进程内处理。
3. 处理器在短 SQLite 事务中以条件更新领取任务，生成 `processing_attempt_id`；只有成功更新一行的调用方取得处理权。
4. 通过 `ResourceService.resolveEntry(projectId, resourceId)` 获取固定代次的原始文件目标，并在整个文件读取 / 正文提取期间持有返回的读取租约；无论成功、失败或取消，都在 `finally` 中释放租约。这样替换 / 删除的安全清理不会在提取器仍使用原始文件时移除资产。解析仍在 SQLite 事务外执行。
5. 提取成功后，重新核对 Resource 仍有效、当前 `assetGeneration` 相同、记录状态仍为 `processing` 且尝试 ID 匹配。
6. 只有所有条件满足时，才在一个 SQLite 事务中同时写入正文、页码映射、提取器版本并将状态改为 `ready`。
7. 不支持格式写入 `metadata_only`；正文为空、文件损坏或解析失败写入 `failed` 和错误码。

文件操作提交与新代次正文记录创建不是同一事务。若进程在两者之间中断，Host 启动对账必须发现当前 Resource 缺少记录或代次不一致并补建 / 重置为 `pending`；正文处理失败不能回滚原始文件操作。Resource 删除则不同：删除事件与正文行删除应在同一 SQLite 事务内提交。

### 6.2 同代次重复触发与重试

- 同一 Resource / 代次已有 `processing` 时，不再领取第二个任务。
- 已为当前代次处于 `ready` 时，普通重复触发直接复用结果，不重复解析。
- `failed` 只通过显式重试回到 `pending`；重试分配新的 `processing_attempt_id`。
- `metadata_only` 普通触发不重复处理；仅在格式支持能力发生变化或显式强制重处理时重新评估。
- 不自动无限重试解析错误；基础设施提交失败时保留可恢复状态，并通过启动对账继续处理。

### 6.3 Host 启动恢复

在 Host 单实例锁成功、Storage 初始化、所有可恢复 Project 的 Resource 投影恢复和现有 ResourceRecovery 完成之后执行。此处同步步骤仅做有界的元数据 / SQLite 对账，不执行 PDF 读取或正文提取：

1. 按 Project 遍历当前有效 Resource，对缺失正文行的 Resource 创建当前代次的 `pending`。
2. 对代次不一致的记录，先使旧正文立即失效，再重置为当前代次的 `pending`。
3. 将遗留的 `processing` 重置为 `pending` 并清除旧尝试 ID。此操作只在新 Host 已取得单实例锁后执行。
4. **反向扫描正文表**：列举 `resource_content` 的全部记录，并按每行的 `project_id` / `resource_id` 核对当前 Resource；清理对应 Resource 已删除或不存在的孤儿记录。Project / Resource 尚未完成恢复时，不得误判为孤儿。
5. 对账完成后，Host 可继续启动；ContentProcessor 在 Host ready 后异步串行消费 `pending`。启动路径不得等待正文提取。

Host 启动时拥有既有单实例锁，因此不设计多 Host 抢占和租约超时。进程内仍通过条件更新与尝试 ID 保护重复触发和迟到结果。启动对账本身必须可重复执行，且不得因某份 PDF 损坏而阻断 Host ready.

### 6.4 删除与读取

- Resource 删除提交后，正文读取先验证 Resource 当前有效性；已删除的 Resource 即使仍残留正文行，也不得返回正文。
- `ResourceLifecycle.delete` 应在同一个 `ctx.storage.atomic` 事务中提交 `resource-deleted` 事件并调用新增的 `tx.deleteResourceContent(projectId, resourceId)` 删除正文行。若事务失败，两者一起回滚；启动反向对账只负责清理历史遗留或异常残留的孤儿记录。
- 正文读取必须验证 `status = ready`、Resource 仍有效，以及 `source_asset_generation = current assetGeneration`。
- 返回给 F13.3 的正文输入应附带 Resource ID、来源代次、提取器版本及可选页码映射；F13.3 不得把过期代次的正文加入索引。

## 7. PDF.js 与正文规范化

### 7.1 引擎

使用 `pdfjs-dist`（Mozilla PDF.js）作为 PDF 解析引擎，不引入 `unpdf` 封装层。PDF.js 为 Apache-2.0 许可；实现时固定兼容当前 Node.js 24 / TypeScript 环境的具体版本并更新 lockfile。当前设计不更改依赖文件。实现须按锁定版本核对 [PDFPageProxy API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html) 与 [PDFDocumentLoadingTask API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentLoadingTask.html)：`page.cleanup()` 返回同步布尔值，而 `loadingTask.destroy()` 返回需等待完成的 Promise。

### 7.2 PDF 提取流程

1. 在读取租约有效期间，从固定代次原始文件读取字节，按锁定版本的 PDF.js Node API 创建 `PDFDocumentLoadingTask`。
2. 检查解析结果与页数上限；按页顺序逐页调用 `getPage(pageNumber)` 和 `getTextContent()`，不对全部页面使用无界 `Promise.all`。
3. 按 PDF.js 文本项顺序拼接文本，并利用 `hasEOL` 恢复行边界。先对单页文本执行确定性规范化，再追加固定的 `\n\n` 分隔符；在最终输出字符串上记录该页 `[start, end)`，不将分隔符计入页面正文区间。拼接完成后不再执行会改变字符数量的全局规范化。
4. 每页的文本复制到输出缓冲后，在该页的 `finally` 中调用同步的 `page.cleanup()`；页级清理返回值按锁定版本 API 解释，不将其误当作 Promise。PDF 文档加载任务在整体提取的 `finally` 中执行并等待 `await loadingTask.destroy()`。
5. 在页间执行取消检查；任何页失败则整个提取失败，不发布部分正文。取消 / 超时需终止当前 PDF.js 加载任务并等待其清理，不得提前释放处理槽位。
6. 对单页文本做有限规范化，保留可用换行与段落；不尝试重建复杂布局、表格、公式或 OCR。
7. 规范化后的完整正文为空白时按 `empty_content` 失败。

PDF.js 能提取 PDF 中已有的文本，但不负责将扫描图片自动转换为文字。扫描 PDF 因正文为空而失败，不归入 `metadata_only`。

### 7.3 Markdown 与 TXT

- 只读取已保存的原始文件，不解析任意网络 URL。
- 按 UTF-8 读取并处理 BOM、统一换行；正文为空白时返回 `empty_content`。
- Markdown 保留原有 Markdown 语法，作为纯文本正文存储；不将其渲染成 HTML。
- TXT / Markdown 的页码映射为空。

### 7.4 资源限制与安全

- 沿用 F13.1a 的原始文件 100 MiB 上限；不意味着解析结果可以无限增长。
- 实现必须设置明确的 PDF 页数、正文 UTF-8 字节数和单次处理并发上限；超过限制时返回稳定错误码，不得部分发布正文。具体数值在实施前通过样例 PDF 验证并写入配置 / 常量与测试，不得无界分配内存。
- 首版建议同一 Host 同时只处理一个正文任务；按页处理并在页间检查取消。运行期取消 / 超时 / 超限必须进入 `failed` 并停止自动重试；只有专用 Host shutdown signal 才允许在优雅关闭时撤销任务并回到 `pending`。强制终止后的恢复由下一次启动对账完成。
- 原始文件是非可信输入；解析异常必须被转换为可诊断的 `failed` 结果，不能导致 Host 崩溃。
- 不执行正文中的任何指令，不将正文解析与 Agent 权限或工具授权相连。
- 错误摘要需限制长度，避免保存大段原始解析器堆栈或不必要的本地绝对路径。

## 8. 幂等、并发与事务不变量

1. 同一 Resource 只有一条当前正文记录。
2. `ready` 的正文必须与该记录的来源代次一致，并与当前有效 Resource 的 `assetGeneration` 一致。
3. `revision` 不作为正文版本键；元数据更新不应触发无意义的重新提取。
4. 任务领取使用数据库条件更新；领取成功才开始解析。
5. `processing_attempt_id` 在每次领取 / 重试时重新生成；旧尝试不能提交新尝试的结果。
6. PDF 解析不在 SQLite 事务内执行。
7. 正文、页码映射、提取器版本和 `ready` 状态必须在同一事务中提交；提交失败时不允许报告正文可用。
8. 提交正文前再次核对 Resource 存在、未删除、代次一致，且记录的状态与尝试 ID 匹配。
9. 原始文件替换或删除后，即使清理正文记录失败，读取层的 Resource 状态 / 代次校验也必须立即拒绝旧正文。
10. 对账与处理操作必须可重复执行；恢复过程中重复启动不能重复写入无意义的 Resource 事件。

## 9. 故障恢复与验收矩阵

| 场景 | 必须保持的不变量 | 恢复规则与测试 |
|---|---|---|
| 1. 正文提取成功 | 正文非空，正文与 `ready` 原子提交，来源代次正确 | TXT / Markdown / 多页 PDF 验证正文、页码映射与状态 |
| 2. 不支持格式、空正文、损坏文件 | 不产生可用正文；不支持格式与解析失败区分 | 不支持格式为 `metadata_only`；空正文为 `failed / empty_content`；损坏文件为 `failed` |
| 3. 提取中途失败 | 不发布部分正文 | 注入页解析错误，断言 body 为空、状态 failed 且错误码稳定 |
| 4. 提取中 Host 被强杀并重启 | 中断任务不永久停留 processing | 强制终止后重启，遗留 processing 变 pending 并成功重处理 |
| 5. 原始文件替换后重处理 | 新代次可用前旧正文不可读 | 替换提交后立即读取旧正文必须失败；新代次最终 ready |
| 6. 原始文件删除 | 删除后正文不可读 | 删除后即使正文行暂留也拒绝读取；重启对账清理孤儿行 |
| 7. 同一代次重复触发 | 同时只有一个有效领取者，ready 不重复解析 | 并发触发，验证条件更新只有一个领取成功且无重复发布 |
| 8. 旧任务与新代次交错完成 | 旧任务不能覆盖新代次 | 让旧代次任务延迟完成，确认代次或尝试 ID 校验拒绝提交 |
| 9. SQLite 提交失败 | 正文与 ready 不出现部分提交 | 在提交时注入失败，确认事务回滚；重启后可恢复 |
| 10. 正文代次与当前 Resource 不一致 | 过期正文永不被读取或交给 F13.3 | 人工构造不一致记录，读取拒绝，启动对账重置并重新处理 |
| 11. 页数 / 正文大小超限或运行期取消 | 不发布部分正文，不自动循环重试，解析资源与租约最终释放 | 注入页数 / UTF-8 字节数超限、取消与超时；断言状态为 `failed`、错误码稳定、调用 `page.cleanup()` 与 `loadingTask.destroy()`，并确认只在显式重试后再次领取 |
| 12. 删除事务原子性 | 删除事件与正文行同时提交或同时回滚 | 在删除事务中注入失败，确认 Resource 未被标记删除且正文行仍一致；成功删除后正文行同步消失 |

补充验收：

- Schema v1、v2、v3 数据库均能迁移至 v4；现有 Resource / 文件操作测试保持通过。
- PDF 解析验证逐页顺序、换行、空白页、页码映射在规范化后仍精确、损坏文件、页数 / 正文大小上限、取消及页面 / 文档资源释放。
- 验证 `project_id` 复合主键与项目范围查询；正文对账覆盖正向补建和反向孤儿清理。
- 验证正文提取期间读取租约始终有效，直到原始文件读取 / 解析完成。
- 不对真实模型、Embedding 或检索质量作验收声明；这些属于后续阶段。

## 10. 实施步骤建议

实施须另行确认启动，不因本设计文档完成而自动授权。

1. **Schema 与存储层**：新增 v4 迁移、`resource_content` 数据访问方法、状态约束与事务测试。
2. **提取器**：定义统一提取器契约，实现 Markdown / TXT 和 PDF.js 逐页提取、页码映射、错误归一及资源限制。
3. **处理器**：实现条件领取、`processing_attempt_id`、结果原子提交、显式重试与过期任务拒绝。
4. **生命周期接入与恢复**：Resource 创建 / 替换后安排处理；Host 启动时对账缺失、过期、遗留处理中及孤儿记录；删除后拒绝旧正文并清理记录。
5. **专项验收**：完成本设计第 9 节矩阵及现有 Resource / Storage / Host 回归。

## 11. 与后续阶段的交接

- **F13.1a** 继续拥有原始资产保存、替换、删除、代次与读取租约。
- **F13.1b** 输出当前代次的规范化正文、正文状态、提取器版本与 PDF 页码映射。
- **F13.1c** 负责 User owner、用户资料导入与管理 RPC；不混入正文提取实现。
- **F13.3** 消费 `ready` 的正文，自行实现 Chunk、Embedding、向量 / 关键词索引和召回。索引状态由 F13.3 独立管理；正文 ready 不等于索引 ready。
- **F13.4** 决定 Agent 的检索时机、预算与按需阅读，不属于本阶段。

## 12. 审核记录与当前状态

- 用户已确认：使用 SQLite 正文方案；正文为空统一记为 failed；保留 PDF 页码映射；保留 `processing_attempt_id`；PDF 解析引擎采用 PDF.js。
- 首轮只读审核（2026-10-20）发现 1 项阻断、5 项重要问题和 4 项一般建议；本修订版已纳入取消语义、页码偏移、项目隔离、启动异步处理、反向对账、PDF.js 清理、STRICT DDL、删除事务、超限验收与读取租约。
- 第二轮只读复审（2026-10-20）结论为 PASS WITH MINOR FIXES：第一轮 10 项问题均已闭环，未发现 Blocker / Major。已补充 DDL 约束，要求非 `ready` 状态下 `page_map_json` 与 `extractor_version` 必须为 NULL；`created_at` 不列为首版必需字段。设计现已冻结，可交由实现 Agent。
- 当前未修改生产代码、依赖或测试。设计审核与文档修订不等于功能实现验收。
