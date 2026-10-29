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
- 本机 PATH 上的 Node 为 v22.23.1（`pi-node`），低于仓库要求的 `>=24.0.0`；本轮完整测试在该版本上通过，CI 使用 Node 24，仍需 CI 复核。
- 推送 GitHub 连续失败（`github.com:443` 超时），本 Step 尚未推送、未开 PR，因此按约定状态记为 🔄 而不是 ✅。

## 验证结果

- `pnpm exec vitest run tests/llm/protocols/completions.spec.ts tests/llm/adapters/deepseek.spec.ts`：15 项通过。
- `pnpm typecheck`：通过。
- `pnpm test`：187 个文件 / 1162 项通过，耗时约 374 秒。
- 真实 API 未调用：本轮只验证解析约定，字段真实形态以提供方返回为准。

## 下一步

网络恢复后推送 `phase16-f16.1-cache-hit`、开 PR，等 CI 通过且本地检查齐备后 squash 合并，再把计划状态改为 ✅。会话级聚合、快照字段与桌面展示仍未规划。
