# F16.1 保留缓存命中信息

## 做了什么

- `src/llm/protocols/completions/stream.ts`：`OpenAiUsage` 增加 `prompt_cache_hit_tokens`；`parseUsage` 在取值为合法非负整数时写入 `TokenUsage.cacheReadTokens`，缺失或非法时省略该键。
- `tests/llm/protocols/completions.spec.ts`：新增三组协议用例，覆盖报告命中、显式 0、缺失与非法（`null`、负数、小数、字符串）四种取值。
- 未改类型、会话存储、RPC、桌面与计划外的任何模块。

## 关键决策

- 非法值静默省略而不是抛错：缓存字段是辅助信息，缺失不应让一次正常响应失败；`prompt_tokens`、`completion_tokens` 的必需校验不变。
- 显式 `0` 保留为 `cacheReadTokens: 0`，与字段缺失区分，后续统计不会把「未报告」误算成「零命中」。
- 不新增 `cacheMissTokens`：未命中可由 `prompt_tokens - cacheReadTokens` 推出，避免冗余字段。
- 只接 Completions 的 `prompt_cache_hit_tokens`，Responses 的 `input_tokens_details.cached_tokens` 不在本步范围。

## 坑与发现

- 协议生成器在 `finish` 未出现时会提前返回，不产出 `usage`。最初用 `choices: []` 的 fixture 导致三条用例都拿不到 usage 事件，改为携带 `finish_reason: "stop"` 的末包后正常；这也说明测试 fixture 必须模拟真实末包形态。
- 本机 PATH 上的 Node 为 v22.23.1（`pi-node`），低于仓库要求的 `>=24.0.0`；本轮完整测试在该版本上通过，CI 使用 Node 24 复核通过。
- 直连 GitHub 连续超时，改用系统已启用的本地代理（`127.0.0.1:7897`）后推送成功；git 配置未持久化代理，后续推送仍需显式指定或自行配置。

## 验证结果

- `pnpm exec vitest run tests/llm/protocols/completions.spec.ts tests/llm/adapters/deepseek.spec.ts`：15 项通过。
- `pnpm typecheck`：通过。
- `pnpm test`：187 个文件 / 1162 项通过，耗时约 374 秒（Node v22.23.1）。
- PR #123 CI `verify` 通过（3m55s，Node 24），squash 合入 master（`84ecd22`）。
- 真实 API 未调用：本轮只验证解析约定，字段真实形态以提供方返回为准。

## 下一步

本 Step 已收口。会话级聚合、上下文快照字段与桌面展示仍未规划，需要时另行立项。
