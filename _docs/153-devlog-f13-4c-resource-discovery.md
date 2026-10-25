# 153：F13.4c 资源目录与按需检索

日期：2026-10-25。范围：仅后端 Resource Tools、Agent Profile、Turn Context 与相关测试 / 文档。已完成本机验证，等待 PR head CI 后收口。

## 做了什么

- `src/tools/builtins/resource/list.ts`：新增 `list_resources`。从 Session Binding 取得 Project / Main 或 Node 身份，先调用 `resources.listVisible()`，再按名称 / 描述、目录筛选和分页；仅投影元数据，不读取正文。
- `src/tools/builtins/resource/search.ts`：新增 `search_resources`。可信身份和当前执行 signal 直接传给 `ctx.retrieval.search()`；沿用 F13.3d 的混合检索默认值、索引兼容与 ACL，投影相关片段和已有关系证据，不增加算法。
- `resource/plugin.ts` 注册两个插件；Main / Node Profile 增加白名单，Main Review 继续从 Main 白名单继承。System Prompt 与工具 description 都强调按信息缺口选工具、已知 ID 可直接读取、不重复走形式化流程。
- `src/project/context.ts` 删除全量目录 Provider；`src/context/turn.ts` 删除 `resource-catalog` 与未实现的 `working-board` section，只保留通用 Builder、runtime-state 与 reminder。序列化、逐请求重建、压缩与计量逻辑继续复用 F13.4a。
- `src/node/context.ts` 仍在权限过滤后比较既有观察事实，只返回新增可见非自有资料的 ID / 名称提醒；不再创建完整资源元数据快照。没有旧观察事实时不伪造新增提醒，首次发现交由工具；资料变化不启动 Turn。
- `src/resource/context.ts` 的唯一函数仅由旧 Main / Node 目录投影使用。迁移 Node 的最小提醒后已无其他调用方，删除文件；没有删除 Resource ACL、读取租约、路径保护或生命周期代码。
- `resource/common.ts` 删除 `withVisibleResourceRefs()`，fetch / update / delete / access 删除 `parametersFor`；`resource_id` 使用普通字符串。保留唯一可见名称兼容解析和全部执行层校验。
- `scripts/compaction/preflight.ts` 去除过时目录样本；手工装配的 Session / Runtime 测试补齐现有 Content、IndexSearch、Graph、Retrieval 服务，以测试实际插件注册与 Profile 权限。既有长期任务、返工、交接离线脚本改为实际调用 list_resources 发现资料后 fetch，工具白名单断言同步新增名称。

## 关键决策

### 架构边界

F13.4a 已提供统一 Turn Context，继续注入动态权威任务状态与必要提醒。Roadmap 负责规划，Project / Node Store 负责权威状态，Resource Store 负责资料和权限；不再单独实施 F13.4b Working Board，也没有相应 Store、迁移或协议占位。

Agent 从当前 Profile 调用资源工具，工具从可信 Session 解析 Project / principal，再进入现有 Resource 或 Retrieval 服务，最后返回工具结果。工具结果走已有 Session 执行记录，可追溯实际调用；没有强制的“目录 -> 搜索 -> 读取”状态机。

### 工具使用与结构

| 工具 | 参数 | 成功返回 |
|---|---|---|
| `list_resources` | `query?`：名称或描述的忽略大小写子串；`folder?`：逻辑目录及后代；`limit?`：默认 30、1–100；`offset?`：默认 0、非负安全整数 | `{ resources: [{ resource_id, name, description, type, libraryPath, revision, ownedByCurrentAgent }], has_more, next_offset }` |
| `search_resources` | `query`：1–4096 字符、不能全空白；`top_k?`：默认 10、1–100；`folder?`：逻辑目录及后代 | `{ status: "found" / "empty", resources: [{ resource_id, name, libraryPath, assetGeneration, snippets: [{ chunkId, text, headingPath, pages, rank, matches, paths }] }] }` |
| `fetch_resource` | 保持 `resource_id`、`start_line?`、`max_lines?` | 保持原文、当前 revision、行号与下一页信息 |

目录和搜索的 JSON 内容直接提供给模型，同时作为已有 artifact 返回；不是只把结构藏在 artifact 中。`next_offset=null` 表示末页；offset 位于权限和条件筛选后的列表，超过末尾返回空页，不泄露隐藏项计数。沿用 Resource Store 的现有顺序，不引入新的分页快照。

`folder` 复用 `normalizeLibraryPath` / `insideFolder`：NFC 可移植相对目录、忽略大小写、包含后代；省略或空字符串表示全部目录。不存在的合法目录返回空列表，不枚举不可见目录。参数 Schema 保持现有工具支持的字段集合，数值范围与安全整数由执行层校验，不扩展通用 Schema 引擎。

`top_k` 是现有检索服务的全局片段预算，每份资料最多三个片段，可能少于请求数量；不改动已有候选预算与排序。`headingPath` / `pages` 无定位时为空数组；`matches` 保留 vector / entity / graph；`paths` 保留实体、关系方向和 `{ resourceId, assetGeneration, chunkId }` 来源证据，无关系时为空数组。

有匹配返回 `status=found`；检索成功但无匹配返回 `status=empty`。ResourceIndexError 转成 `isError=true` 的工具失败，模型可看到 `Resource search failed (embedding-unconfigured / index-failed / index-stale).` 等错误码；内部诊断由现有 failure/cause 留存，不伪造空结果。范围内没有可见资料时，沿用检索服务的空结果短路，即使未配置 Embedding 也不进行查询。

已知信息足够时无需检索；浏览资料集合或目录使用 list；有明确主题或证据目标优先 search；需要更多原文或核对证据时使用 fetch 的行分页。可以直接 fetch 已知有效 ID，不需要先 list 或 search。明确要求查阅资料时仍应查阅，资料不足或来源冲突应如实报告。

### 权限与生命周期

- 模型参数不提供 Project、principal 或 Node 身份入口，额外伪造字段由既有 Schema 校验拒绝；身份只来自 `requireResourceToolCaller()` / `requireAgentBinding()`。
- 目录先 ACL 再过滤和分页；检索完全复用现有服务，在异步向量查询后重查可见范围，图谱读取仅包含权限内当前来源证据。
- `resolveResourceRef()` 仍只在当前可见资料中解析 ID / 唯一名称。即使字符串不在旧 enum 中，也必须通过读取阶段的 Project / ACL / 文件边界检查；更新和删除仍要求 owner 与 expected_revision；访问权限仍仅 Main 可改。
- search 传递执行 signal，调用前后检查取消；ToolService 保留 cancelled 结果。fetch 的文件读取分页、读取租约与取消原样保留，删除继续等待既有租约清理。
- 不修改持久化格式；Node 既有 context-observed 事实继续支持跨 Turn / 重启去重。已存在的历史工具结果与提醒不撤回，也不因取消目录注入而删除。

## 坑与发现

- 旧 Node context 单元测试原先断言全量 resources；现在分别断言新增提醒和观察事实。`changedFacts(undefined, current)` 原本就不发首次新增提醒，测试使用显式空观察集合模拟“之前无资料”，未改变生产语义。
- 移除动态资源 ID enum 不影响 `set_resource_access.access.kind` 的固定合法值 enum；测试只禁止 `resource_id` 动态枚举。
- Reminder 自身和 Turn Context 都做数据转义；测试核对提醒转义及外层不存在原始结束标签，保留两层现有保护。
- 新增工具和调用指导后，两个使用 24k 小窗口的恢复场景在 Main review 进入模型前触发 `context-compaction-no-progress`：固定提示 / 工具 / 当前审查内容不可压缩。沿用已有 28k Main 预设；暂停恢复场景把前三次输出从 10k 增至 16k 字符，仍要求暂停前已提交检查点，watch 场景仍要求至少两次压力压缩；不改生产阈值或失败行为。
- 首轮默认并发的 Host 首次启动超时（15 秒），同代码单项以一个 worker 复验通过，未修改 Host 或超时值；后续完整验证使用 CI 同样的四 worker 设置。没有据此断言超时根因。
- 已复核本次 TypeScript 文件行数：既有 `tests/node/session.spec.ts` 为 297 行，集中覆盖同一 Session 生命周期，本次只补齐服务装配，保持原有场景边界；本次没有超过 300 行的修改文件，新增文件均小于 300 行。

## 验证结果与边界

运行环境：Windows PowerShell，Node 24.22.1；PATH 首项为 Windows System32，随后为 Codex bundled Node。

- `pnpm typecheck`：通过。
- 资源 / 上下文 / Profile / Session / review 定向 15 文件共 88 项分次回归通过；新增 3 文件 / 35 项工具专项及 1 项 Profile 测试。
- 首轮 `pnpm test`：158 文件，150 通过 / 8 失败；1032 项，1021 通过 / 11 失败，317.24 秒。失败包括旧工具列表 / 全量目录断言、两项小窗口 Main review 固定成本问题、交接超时和 Host 首次启动超时。修正相关离线脚本后 7 文件 / 12 项中剩两项窗口问题；窗口与样本调整后 2 文件 / 4 项通过；Host 首次启动专项 1 项通过（25 项因名称筛选跳过）。
- `pnpm test --maxWorkers=4`：158 文件 / 1032 项全部通过，退出码 0，314.36 秒；包含默认 all 模式的进程中断恢复。
- `git diff --check` 与 staged diff 检查：通过；文档相对链接存在性检查通过，src / scripts 中旧目录类型与 helper 引用无残留。
- 当前 PR head CI：待验证；本机通过不替代 CI。

新增工具单元测试和真实 SQLite / 离线 Embedding / 图谱集成覆盖可信 Main / Node 身份、名称与描述 / 后代目录筛选、分页边界、非法及伪造参数、空结果 / 检索错误、私有资料及关系证据隔离、异步撤权、已知 ID 直接读取、取消、Session Binding 重启恢复与删除后的不可见性。现有资源 CRUD、访问控制、压缩和进程中断恢复由相关回归及完整后端套件验证。

未运行真实模型、真实 Embedding 服务或 GPU 任务，不声明检索质量或实际模型工具选择已验收。没有前端、RPC、F13.5 或其他阶段改动；F13.4 父项仍需按后续授权补充产品过程展示等验收。

## 下一步

仅完成当前 F13.4c 的本机检查、PR、当前 head CI 与按仓库规则的 squash 合并及开发分支清理。后续阶段等待单独授权。
