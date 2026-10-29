# DeepSeek 缓存命中率调研

## 做了什么

- 静态核查 DeepSeek usage 的缓存字段在 Navo 中的去向。
- 核查本机历史会话是否留有可统计的用量数据。
- 用临时探针跑真实 DeepSeek 会话，抓取 SSE 原始 `usage`，测量冷启动与跨进程复用两种前缀场景下的命中率。探针不属于交付物，运行后已删除；本记录保留方法与结果。

## 核查结论

- `src/llm/protocols/completions/stream.ts` 的 `parseUsage` 只保留 `prompt_tokens`、`completion_tokens`、`total_tokens` 与 `reasoning_tokens`，DeepSeek 返回的 `prompt_cache_hit_tokens`、`prompt_cache_miss_tokens` 被丢弃。`OpenAiUsage` 接口也没有声明这两个字段。
- `TokenUsage` 已有 `cacheReadTokens`、`cacheWriteTokens`（`src/llm/types.ts`），会话历史运行时校验也允许这两个字段（`src/session/history.ts`），但全仓没有任何赋值点，属于为其它协议预留、DeepSeek 路径从未写入的字段。
- 因此当前没有可查询的命中率；上下文计量（`src/context/meter.ts`）只把 `inputTokens` 全量计入已用 token，不区分命中。
- 本机 `~/.navo/navo.db` 只有 2 条 `project-created` 事件、`ordinary_sessions` 为 0，即使字段被保留也没有真实会话可供回算。

## 测量方法

临时探针在仓库内运行（`tsx`），使用真实生产代码而非手写 HTTP 请求：

- `DeepSeekAdapter`（真实适配器）注入自定义 `fetch`，把响应体 `tee()` 后旁路解析 SSE，收集最终 `usage`。中间事件的 `usage` 为 `null`，与 BUG-039 的结论一致。
- `AgentRuntime` + `SessionStore` + `ToolService` 走真实回合循环；system prompt 取 `createMainAgentProfile().systemPrompt`；工具用 12 个真实内置工具工厂（`read_roadmap`、`read_node`、`create_roadmap`、7 个 Resource 工具、`read_mailbox`、`set_project_goal`）注册，未注册需要外部适配器的 `web_search`、`web_fetch`、file 工具与 5 个 Roadmap 变更工具，因此工具前缀比完整 Main Agent 略小。
- 一个会话内连跑 4 轮短问答，每轮 1 步；模型 `deepseek-flash`，`maxTokens=400`。

## 结果

冷前缀（system prompt 开头加随机 nonce，确保与历史缓存不共享前缀）：

| 请求 | prompt_tokens | 命中 | 未命中 | 命中率 |
| --- | --- | --- | --- | --- |
| 1 | 3472 | 0 | 3472 | 0% |
| 2 | 3559 | 3328 | 231 | 93.5% |
| 3 | 3711 | 3456 | 255 | 93.1% |
| 4 | 3789 | 3584 | 205 | 94.6% |
| 合计 | 14531 | 10368 | 2063 | 71.4% |

热前缀（与上一轮探针的 system prompt、工具、首条用户消息完全相同，间隔数分钟）：

| 请求 | prompt_tokens | 命中 | 未命中 | 命中率 |
| --- | --- | --- | --- | --- |
| 1 | 3463 | 3328 | 135 | 96.1% |
| 2 | 3593 | 3456 | 137 | 96.2% |
| 3 | 3718 | 3584 | 134 | 96.4% |
| 4 | 3841 | 3584 | 257 | 93.3% |
| 合计 | 14615 | 13952 | 663 | 95.5% |

## 关键决策

- 测真实适配器而不是手拼请求，是为了让测到的前缀就是 Navo 实际发出的前缀；否则无法排除序列化差异。
- 冷、热两组分开测：冷组回答“全新前缀的第一轮命中率”，热组回答“同一构建再次打开会话时还能不能命中”。
- 命中量按 64 token 块对齐（3328、3456、3584 都是 64 的倍数），说明 DeepSeek 只缓存完整块，记录时不应把零头算进命中。

## 坑与发现

- 首次冷请求命中率为 0，从第二轮起稳定在 93%–95%；单请求看不到的“冷启动成本”只体现在会话第一条请求上。
- 跨进程、跨会话复用成立：只要 system prompt、工具定义、消息内容逐字节相同，新会话的第一条请求就能命中 96%。这意味着同一构建的第二次打开通常不是冷启动。
- `_docs/69-interview-longterm-bugs.md` 中“system 每 Turn 重建，所以提示前缀缓存在 Turn 边界已经失效”的判断不成立：重建的是消息对象，序列化后的文本没有变化，实测仍然命中。
- 会截断命中的只有前缀本身改变：修改 system prompt、工具集合或顺序（含 MCP 工具增删与重连顺序）、`surface` 的 replace（压缩）以及历史中任何回填。`turnContext` 位于消息末尾，不影响前缀。
- 命中率不改变 `prompt_tokens`，只看 token 用量无法回算命中；必须保存 `prompt_cache_hit_tokens`。

## 下一步

若要把它变成常规指标，最小改动是让 DeepSeek 适配器把 `prompt_cache_hit_tokens` 映射为 `cacheReadTokens`（`TokenUsage` 与历史校验已具备），命中率即 `cacheReadTokens / inputTokens`；再提供按会话/项目聚合的读取口径。该改动涉及生产代码与前端展示，需按 Step 流程单独规划与确认，本次仅调研，未修改仓库源码。
