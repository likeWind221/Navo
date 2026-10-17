# F12.1 Context Meter 与模型容量

> 日期：2026-10-16  
> 状态：✅ 完成  
> 范围：模型上下文容量与压缩上限的声明、压缩预算、Session 上下文压力测量与越线判定；不接入 AgentRuntime，不写新 Session 事件。

## 做了什么

- `src/host/config.ts`：两个 provider 都解析 `LLM_CONTEXT_WINDOW` 与 `LLM_AUTO_COMPACT_LIMIT`（正整数，≤ 10,000,000，非法值启动报错，不设置则保持原行为），写入 `TurnModelConfig.contextWindow` / `autoCompactLimit`。
- `src/context/budget.ts`：`resolveContextBudget` 把模型配置换算为阈值与保留预算，或给出禁用原因；`contextPressure` 给出 used / threshold / window 与是否越线。
- `src/context/meter.ts`：文本、消息、工具 schema 的启发式估算，以及 `measureContext(events, request)`。
- 测试：`tests/context/meter.spec.ts`、`tests/context/budget.spec.ts`，`tests/host/config.spec.ts` 增加容量配置用例。

## 关键决策

### 预算公式

~~~text
W = contextWindow, O = maxTokens ?? 32768, H = 16384, L = autoCompactLimit
有 W:   threshold = min(floor(min(0.8W, W - O - H)), L)
        retain    = min(floor((W - O) * 0.16), floor(threshold * 0.2))
        W - O - H <= 0          -> disabled: no-pressure-budget（即使设置了 L）
只有 L: threshold = L, retain = floor(L * 0.2)
都没有: disabled: missing-capacity
~~~

- `L` 对应 Codex `model_auto_compact_token_limit`（`codex-rs/protocol/src/openai_models.rs` `auto_compact_token_limit()`：取配置值与 90% 窗口的较小者，没有窗口时单独生效）。Navo 用它把阈值调低，用于真实模型上的压缩验收，或在 Qwen 服务端窗口不确定时给保守值。
- 保留预算额外限制为阈值的 20%（等于默认 0.16 / 0.8）：F12.0 原计划沿用 Harness `resolveCompactSpec` 的“retain ≥ threshold 则报错”，但在低 `L` 的验收场景下这条规则会直接禁用压缩，因此改为按阈值收缩保留预算，`retain-not-below-threshold` 这个禁用原因随之删除。
- 窗口太小时，即使设置了 `L` 也禁用：输出预留与余量已经吃掉窗口，压缩后的请求同样装不下。
- ChatGPT 订阅模型没有 `maxTokens`，输出预留按 32768 计。

### 测量算法

~~~text
anchor = 最后一条 assistant-message（必须带 usage）
       + 它之前同 stepId 的最后一条 llm-requested（重试时取最后一次）
       + provider / model 与当前请求一致
anchorEstimate = estimate(anchor 请求) + estimate(anchor 回复)
baseline       = max(usage.input + usage.output, anchorEstimate)
used           = baseline + estimate(当前请求) - anchorEstimate
无 anchor       -> used = estimate(当前请求)
~~~

- 与 Codex `context_manager/history.rs` `get_total_token_usage` 同类：以最近一次模型调用的真实 usage 为主体，只估算之后的变化。差异：Codex 只累加“最后一个模型输出之后的新条目”，Navo 用整份请求的有符号差，因为 Main / Node 的系统提示每个 Turn 重建快照，只加新条目会漏掉系统提示变化；有符号差也让压缩替换（surface 变短）直接体现为用量下降。
- usage 低于同一请求的启发式估算时取估算（对齐 Harness `token-meter` `measure()` 的保守锚点规则），`basis` 标为 `estimate`。
- Navo 的 `inputTokens` 已包含缓存命中（Completions `prompt_tokens`、Responses `input_tokens`），不再像 Harness 那样额外累加 cacheRead / cacheWrite。
- 估算：CJK（汉字、假名、谚文）每字 1 token，其余字符每 4 个 1 token；每条消息、每个内容块各加 4 token 结构开销（Harness `estimate.ts` 常量）。reasoning 块计入估算：Qwen 会回放 `reasoning_content`，服务端是否计入未知，偏高估算由下一次真实 usage 锚点纠正。Responses 的 replay 只计 `contentIndex === null` 的隐藏条目，避免与可见内容块重复。
- Meter 是纯函数，不持久化；usage 已在 `assistant-message` 事件中落盘，重启后自然可用。

## 坑与发现

- `0.16 / 0.8` 的浮点结果是 `0.19999999999999998`，会让 `floor(20000 × ratio)` 得到 3999，常量直接写 0.2。
- 换模型（重启时改 `LLM_MODEL`）会让锚点失效、退回整份估算，这是有意的：旧模型的 usage 不能代表新模型的 tokenizer。

## 验证

- 本机 Windows 11：`pnpm typecheck` 通过；PowerShell 下 `pnpm test` 114 个文件 / 711 项全部通过（新增 `tests/context` 18 项、配置 2 项）。
- 在 Git Bash 下运行 `pnpm test` 会有 12 项 ChatGPT 凭据测试失败：PATH 中 `whoami.exe` 解析到 Git 自带的 GNU coreutils，而不是 Windows 自带版本，与本次改动无关；完整验证以 PowerShell 结果为准。
- 未验证：Meter 尚未接入回合执行，真实模型下的估算偏差留待 F12.2 / F12.6 观察。

## Codex 调研留给后续 Step 的待定项

- F12.3：是否在被遮蔽区域中保留人类直接输入的用户消息原文（Codex `compact.rs` `build_compacted_history` 保留最近 20k token 的用户消息，以免纠正类指令丢失），需排除 system-reminder 与旧检查点；摘要请求本身超窗时从头部逐条删除后重试（Codex `remove_first_item`）。
- F12.4：无法恢复的超窗把用量标记为已满（Codex `set_total_tokens_full`）。
- F12.5：ChatGPT 模型目录若返回 `context_window`，可在公共模型信息中展示，方便配置。
- 不采用：后台预压缩、回合结束后压缩、向模型注入剩余上下文提示、远程压缩接口（`compact_remote_v2*` 未细读）、95% 可用窗口（Navo 阈值公式已更严格）。

## 下一步

F12.2 上下文压力检测与执行接入：在模型请求前接入本 Step 的预算与测量；摘要生成与检查点写入独立安排在 F12.3。
