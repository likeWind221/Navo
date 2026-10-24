# BUG-026：双路检索精简与 Chunk Top-K

日期：2026-10-24
状态：✅ 本机完整验证与当前代码 head CI 通过，PR #94 已合入 master（408a83c）。

## 现象与复现

PR #93 实现向量、独立 FTS5/BM25、图谱三路召回；默认 topK=10 表示 10 组 Resource，每组最多 5 个 Chunk。用户要求恢复向量与图谱两路，最终按 Chunk 计数。本轮是 F13.3d 既有能力修复，不是新 Step，当前 Agent 串行维护共享文档。

## 已证实事实与根因假设

已核实 retrieval.ts 在分组后按 topK 截断，lexical.ts 是独立文本通道；实体名称匹配由 graph.ts 独立负责，不依赖 FTS5。属于已确认设计偏差。原交付记录 [147](147-devlog-f13-3d-retrieval.md) 保留历史事实，当前检索语义以本记录为准。

## 修复内容

```text
Query + Project + Viewer
          |
[reuse] Resource ACL / folder scope
          |
[modify] Vector Top-30 --------> [modify] Graph seeds
          |                     exact names + <=10 semantic entities
          |                              |
          |                     [modify] <=2 hops / <=40 chunks
          |                              |
          +---------------+--------------+
                          |
              [reuse] RRF + current source checks
                          |
              [modify] Global Chunk Top-K / <=3 per Resource
                          |
              [modify] Resource groups + global rank
```

- `src/resource/retrieval.ts` 的 `search()` 保留 hybrid（默认）和 vector；移除 keyword 模式，运行时拒绝旧模式。`vectorTopK` 默认 30、范围 1–100，独立于最终 `topK`（默认 10、范围 1–100）。`maxHops` 默认 2、范围 0–2。先调用现有向量入口，返回后重读 `scope()`（权限、ID、文件夹后代的交集），再读取范围内图谱；空范围不调用 Provider。原有 4096 字符、取消、错误透传、当前 Chunk 和资产代次校验保留。
- `search()` 按两路 RRF 的全局排名逐个查找有效 Chunk。无效或某 Resource 已有 3 个时跳过，继续补选后续候选，直到 topK 或候选耗尽。仅在接纳时产生连续 `rank`，从 1 开始；然后按首次命中顺序组成 Resource 组，组内保留排名顺序，资料分数仍为最佳 Chunk 分数。分组并不构成全局顺序，消费方按 Chunk.rank 排序恢复；不会先选 10 组再输出最多 50 个。候选不足、有效性过滤或每资料上限都可能使数量小于 topK。
- `retrieval/types.ts` 增加内部请求 vectorTopK 和 Chunk.rank，移除 keyword 模式 / 来源类型；不新增公共 RPC 或 UI 协议。`IndexSearch` 自身的 topK 和余弦分数语义不变。
- `retrieval/graph.ts` 的 `graphSearch()` 保留 `mentions()` 的 NFKC、大小写归一、非汉字完整名称边界和汉字名称子串匹配；精确名称种子最多 16。按向量 Chunk 排名收集对应实体，排除已直接命中的实体，语义派生实体最多 10，再合并为种子。沿用 `node()`、按种子/实体去重的双向 BFS、每来源最多 8 份、64 个访问状态及 100 条路径边界；统一入口把跳数限定为两跳。图谱候选按首次出现顺序最多保留 40 个不同 Chunk，同一个已保留 Chunk 的其他路径仍保留。实体命中和关系扩展共属图谱一路，不额外增加 RRF 权重。
- `retrieval/fusion.ts` 复用等权 `1/(60+rank)` RRF、单路重复 Chunk 只计一次分、来源与路径合并、Chunk ID 稳定平分排序，不改算法。
- 删除 `retrieval/lexical.ts`，移除入口专用 `chunks()` 全量扫描和 `src/storage/retrieval.ts` 的 `scanSearchChunks` / `SearchChunkQuery`。存储模块只保留输出前实际使用的 `getSearchChunk()`，职责仍为当前 active build、ready 正文代次与 Chunker 版本校验。没有依赖或 Schema 变化；已有向量索引的分批扫描不受影响。

例如融合后 A1、B1、A2、A3、A4、C1，topK=5：选 A1(rank1)、B1(rank2)、A2(rank3)、A3(rank4)，A4 因同资料上限跳过，补 C1(rank5)。返回 A/B/C 三组，不能直接把各组拼接当作全局排名。

### Harness 对照与取舍

实施前只读检查固定提交 `687f282e8625c6b8d11ff58211a90524be2e4317` 的 [packages/llm/llm-deepseek/src/adapter.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm-deepseek/src/adapter.ts)：`generate()` / `request()` 使用调用方取消信号并清理传输。本次保持 Navo 既有 Provider 的 AbortSignal 与异步返回后取消检查，不修改传输或新增 Runtime、重试和静默降级。Harness 此文件不提供 GraphRAG 候选算法；30/10/40 是本项目按用户建议采用的首版预算，不是行业标准或效果最优结论。

短文件复核：存储检索是事务能力边界，内部 types 是请求/结果协议，fusion 有独立算法回归，均保留原职责文件；本次无超过 300 行的新增或修改手写文件。

## 验证结果与边界

- Node v24.19.0，临时 PATH 将 Windows System32 与 bundled Node 置前，不改全局环境。
- 初次专项测试新写的 Provider 夹具多了一个右花括号，导致 search.spec.ts 解析失败；修正后检索专项 2 文件 / 21 项与 typecheck 通过。随后增加图候选恰好 40 个的回归；最终 `pnpm typecheck` 通过，完整 `pnpm test --maxWorkers=4` 为 152 文件 / 985 项全部通过（280.13 秒），检索部分 22 项；`git diff --check` 通过。
- 回归覆盖：无向量命中的中英文实体名称、两跳/反向/环路/私有桥梁、最多 10 个语义实体和 40 个图候选、两路 RRF、全局 Top-K 与每资料 3 个、跨组 rank、候选预算独立传参、目录与 ID 范围、撤权/替换/删除/取消、重开持久库与未配置 Provider。
- 不运行真实模型 / API / GPU 任务；不声称实际召回质量、规模性能或双路优于三路已由实验证明。同步图快照仍可能读取整个可见图，候选 40 个不等于图读取内存上限。没有配置 Provider 时两种模式均明确报错，不降级为文本搜索。
- 不修改 Fetch / BUG-025，也不因此关闭已有未修复问题。

## 后续

跟踪入口见 [Bug 计划](bug-plan.md)。[PR #94](https://github.com/likeWind221/Navo/pull/94) 代码 head `57c9121` 的 [CI run 40104826929](https://github.com/likeWind221/Navo/actions/runs/40104826929) 全部成功（typecheck、normal tests、crash recovery tests），已 squash 合入 master（`408a83c`）。本地与远端修复分支已删除，保留主仓库和既有其他 worktree；无本次专用开发目录。最终回复交付模块地图、代码导读和实际边界。只修复既有 F13.3d，不启动 F13.4、公共 RPC / Bridge、前端、重排模型或社区检索。当前请求/输出为已接入 ctx.retrieval.search 的内部能力。最终交付需附代码导读。
