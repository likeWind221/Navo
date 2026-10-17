# F12.0 上下文压缩设计收口

> 日期：2026-10-16  
> 状态：✅ 基础设计已收口；F12.1–F12.4 已落地，F12.5 新增 Human 主动压缩命令  
> 范围：只收口 Phase 12 的上下文测量、Session 压缩、摘要检查点与恢复语义；不修改生产代码。跨 Session 检索与可召回压缩归入 Phase 13。

## 1. 做了什么

- 只读调研 DeepSeek Harness（commit `d743267388641bc76f17c45ce8b4c231aed1d32c`）的压缩子系统，对照 Navo 现有 Session surface、请求构建、模型配置和重启恢复。
- 收口 Phase 12 的状态、触发、事务事件、选区、摘要、失败 / 取消 / 中断以及与 F11 AutoRun 的衔接规则。
- 在 [backend-plan.md](backend-plan.md) 中拆出 F12.1–F12.7 的功能目标；经用户确认，将压力检测接入与摘要检查点实现分为两个独立 Step。

## 2. 问题与现状

F11 让 Main / Node Session 可以连续推进几十个 Turn，而 Navo 目前：

- `src/agent/request.ts` 的 `buildRequest` 每一步把完整 surface 发给模型，没有任何上下文上限检查；
- 模型配置只有 `provider` / `model` / `maxTokens`，不知道模型的上下文容量；
- Qwen adapter 把所有非 401/403/429/5xx 映射为 `INVALID_REQUEST`，OpenAI adapter 透传 provider code，"上下文超窗"无法与普通请求错误区分，也就无法恢复。

可直接复用的基础：

- `src/session/surface.ts` 已支持 `surfaceOp: { op: "replace", start, end }` 与 `generation`，`src/session/history.ts` 重启解析时会校验 replace；
- 系统提示不在 surface 中，而是每个 Turn 由 profile 重建、由 `withSystemPrompt` 注入；Main / Node 的 Project 状态、Node 目标与 available-resources 快照都在系统提示中，因此压缩永远不会丢失“当前权威状态”，摘要只需保留工作过程；
- 同一 Session 的 Turn 已由 AgentRuntime 串行，压缩发生在 Turn 内部即可，不需要额外的跨入口互斥。

## 3. Harness 对照

| Harness 源码 | 机制 | Navo 采用方式 |
|---|---|---|
| `docs/subsystems/compaction.md`、`packages/compaction/compaction/src/index.ts` | 压缩是可选能力，不进入 agent loop 主干；`compaction/start` → summary → 替换 user/message → `compaction/end`，未闭合 start 即崩溃证据 | 采用事务形态与“最后才写 end”的锁语义；压缩逻辑放在 Agent 核心的独立模块，由 Step 在请求前调用，不做 Cordis 能力 seam 和可替换 provider |
| `compaction-basic/src/config.ts` `resolveCompactSpec` | 阈值 `floor(min(W×0.9, W−O−headroom))`，尾部保留 `(W−O)×0.16`，`retain < threshold` 校验 | 采用公式与校验；headroom 默认改为 16384（Harness 65536 对 Navo 常用窗口过大），不做 `modelPolicies` 表，按当前模型配置一份 |
| `compaction-basic/src/summarizer.ts` | 回放系统提示 + 被遮蔽区域 + 一条结构化指令；摘要用 `<compacted-summary>` 包裹并加续接前言；旧摘要合并而非照抄 | 采用回放与包裹方式；指令改为不绑定编码领域的研究 / 项目通用结构，并要求使用对话主要语言（对应 Harness `2026-07-31-english-compaction-checkpoints` 的教训） |
| `token-meter` | 以最近 provider usage 为锚点，加 surface 变化的有符号重定价；按路由给图片定价 | 只采用“usage 锚点 + 新增节点启发式估算”；不做路由定价、图片定价和 shadow-price 事件 |
| `agent/request-error` 溢出恢复、`maxOverflowRetries` | provider 确认超窗后绕过阈值做一次最大平衡缩减，只有 surface generation 前进才重试 | 采用；由 adapter 把超窗归一为 `CONTEXT_WINDOW_EXCEEDED` |
| `toolPairingBalancedBefore/After` | 选区边界不得拆开 tool call 与 result | 采用为切分规则 |
| `compaction-tool-result-pruner`、`compaction-image-offload`、`command-compact`、`recallable-compaction` 提案 | 工具结果剪枝、图片省略、手动 `/compact`、可召回压缩 | F12.5 采用手动 `/compact`；工具结果剪枝与图片省略暂不采用；可召回压缩归 Phase 13 |

## 4. 关键决策

### 4.1 适用范围

压缩是 Session 级能力，作用于所有经 AgentRuntime 运行的 Session（普通会话、Main、Node），不感知 Project / Roadmap。Project 领域只通过系统提示提供权威状态，不参与压缩决策。

### 4.2 模型容量与 Context Meter

- 每个模型配置声明 `contextWindow`（token）。Qwen 通过环境配置声明；ChatGPT 订阅模型的模型列表目前只解析 slug 与名称，F12.1 先确认其是否提供容量，未提供则由配置声明。具体默认值在 F12.1 记录。
- 容量缺失时：禁用压力触发，并在 Host 启动日志警告一次；超窗恢复仍可用。
- 压力 = 本 Session 最近一次成功 `assistant-message` 的 `usage.inputTokens + outputTokens` 作为锚点，加锚点之后新增 surface 节点的估算；锚点之后发生过 replace、或不存在 usage 时，对系统提示 + 工具 schema + 全部 surface 做完整估算。
- 估算启发式：CJK 字符按 1 token，其余字符按 4 字符 1 token，向上取整。Meter 是对 Session 事件与当前请求的纯计算，不持久化。

~~~text
W = contextWindow, O = 请求 maxTokens, H = headroomTokens (默认 16384)
thresholdTokens = floor(min(W * 0.9, W - O - H))
retainTokens    = floor((W - O) * 0.16)
约束: W - O - H > 0, retainTokens < thresholdTokens, 否则视为配置错误并禁用压力触发
~~~

### 4.3 触发点

~~~text
Step start
   |
   v
Context Meter --(pressure < threshold)--------------------+
   |                                                      |
   | pressure >= threshold                                |
   v                                                      |
Compaction(trigger = pressure), 最多 compactionRetries 轮  |
   |  (失败: 记录后继续原请求)                              |
   v                                                      v
buildRequest -> LLM ------------------------------------> response
   |
   | CONTEXT_WINDOW_EXCEEDED
   v
Compaction(trigger = overflow, 忽略阈值, 最大平衡缩减)
   |-- surface generation 前进 --> 重试一次请求
   +-- 无进展 / 失败 ------------> Step failed: context-window-exceeded
~~~

- 压力触发：每个 Step 在构建请求前检查；一轮压缩后重新测量，仍越线则再压，默认 `compactionRetries = 1`（即最多两轮）。
- 超窗恢复：adapter 把 provider 的超窗错误归一为 `CONTEXT_WINDOW_EXCEEDED`（OpenAI 的 `context_length_exceeded`；Qwen 需读取 400 响应体判断）。默认 `maxOverflowRetries = 1`，不消耗既有模型重试预算。
- Human 可通过 `/compact` 主动压缩；该入口安排在 F12.5，命令不要求压力超过阈值，仍必须遵守安全选区、近期尾部保留与压缩收益检查。

### 4.4 选区规则

- 候选范围总是从 surface 头部开始，包含此前的摘要检查点，因此新摘要会合并旧摘要。
- 从尾部向前累计，直到保留尾部 ≥ `retainTokens`；切点只能落在“此前所有 tool call 都已有 result”的位置。
- 摘要请求本身也必须装得下：被遮蔽区域 + 系统提示 + 指令的估算 ≤ `W − summaryMaxTokens − H`，超出时缩短区域前缀，剩余部分由下一轮压缩处理。
- 区域少于 2 个节点或可释放 token 不足阈值 10% 时视为无效选区，不写任何事件。
- 超窗恢复忽略 `retainTokens`，只保留最后一个可切分点之后的内容。
- 允许压缩当前 Turn 的开头（包括本 Turn 的 user message）；指令要求摘要保留“当前请求”。

### 4.5 事务事件与检查点

新增压缩开始/结束 log-only 事件，以及可改变 surface 的 `compaction-checkpoint` 消息事件：

| 事件 | 数据 | 作用 |
|---|---|---|
| `compaction-started` | `{ compactionId, turnId?, trigger: "pressure" \| "overflow" \| "manual" }` | 事务锁，必须先于摘要请求写入；pressure / overflow 需要 turnId，manual 不属于 Turn |
| `compaction-checkpoint`（`surfaceOp: replace`） | `{ message, compactionId, turnId? }` | 唯一的 surface 变更：用摘要检查点替换选区；manual 检查点不伪造 turnId |
| `compaction-ended` | `{ compactionId, turnId?, status: "completed" \| "failed" \| "cancelled" \| "interrupted", shadowedSequences?, shadowedTokens?, summaryTokens?, provider?, model?, usage?, failure? }` | 释放锁，并记录统计与失败原因；manual 事务没有 turnId |

- 写入顺序固定为 started → replace（仅成功时）→ ended。崩溃留下未闭合 started 可被检测；不把摘要元数据单独成事件，统计信息并入 ended。
- 摘要请求不写 `llm-requested`，避免污染 Turn / Step 请求快照与 Meter 锚点；provider / model / usage 记录在 ended 中。
- 检查点消息文本 = 续接前言 + `<compacted-summary>` + 摘要 + `</compacted-summary>`。`compactionId` 让历史投影和前端无需扫描相邻事件即可识别检查点。
- F12.5 增加 `trigger: manual`。`compaction-started` / checkpoint / `compaction-ended` 的 `turnId` 对独立 manual 操作可选；旧 pressure / overflow 事件继续要求 Turn 身份。历史校验与启动恢复必须兼容两类事件。

### 4.6 摘要请求

- 使用当前 Turn 的模型。`maxTokens = min(请求 maxTokens, 8192)`；工具 schema 与 Turn 相同，以保证含 tool call 的历史在各协议下合法、尽量复用前缀缓存，同时指令禁止调用工具。
- 只取返回的 text 内容，忽略 reasoning 和 tool call；没有文本时视为失败。
- 摘要估算 token ≥ 被遮蔽 token 时判为 `compaction-not-shrinking` 失败。
- 指令结构（中性领域）：目标与用户要求、关键事实与发现（保留来源、Resource ID、路径、数值）、已完成工作、错误与修正、未完成事项、当前进度、下一步、关键约束与决策。要求合并旧检查点，不提及压缩本身，并使用对话主要语言，标识符保持原样。
- 超时、取消与可重试失败复用既有 `createDeadline` 和模型重试策略。

### 4.7 失败、取消与中断

| 情况 | 记录 | Turn 结果 |
|---|---|---|
| 压力压缩失败（摘要错误、不收缩、无文本） | ended `failed` + `error` 事件（source `runtime`，code `compaction-failed`） | 不失败，继续发原请求 |
| 压力下无有效选区 | 不写事件 | 继续发原请求 |
| 超窗恢复无进展或失败 | ended `failed`（若已开始）+ Step failure `context-window-exceeded`（不可重试） | failed；AutoRun 按 F11.2 暂停并记录原因 |
| Turn 取消 | ended `cancelled`，不写 replace | cancelled |
| 进程退出 / 崩溃 | 重启恢复时为未闭合 started 补写 ended `interrupted`，顺序先于 F10.3 的 Turn 收尾 | 按 F10.3 记为失败，不自动续跑 |

replace 已落盘但 ended 未写时，重启后仍补写 `interrupted`；surface 以日志回放为准，检查点保持有效。

### 4.8 公共契约方向

F12.6 定义：每个 Session 的上下文用量（已用 / 容量 / 阈值）查询、压缩开始与结束的实时事件，以及历史查询中把检查点标记为摘要而非普通用户消息。F12.5 先补齐主动压缩命令。前端展示交由 [frontend-plan.md](frontend-plan.md) 的后续步骤，不在 F12 后端范围内。

## 5. 子 Step 拆分

| Step | 功能目标 |
|---|---|
| F12.1 | 每个模型声明上下文容量；每次请求前能算出 Session 的上下文压力并判断是否越过阈值，容量缺失或配置矛盾时明确禁用自动压缩 |
| F12.2 | 在模型请求前接入 Context Meter，判断上下文压力并提供明确的压缩触发点；阈值以下保持现有执行行为 |
| F12.3 | 越过阈值时把可压缩历史替换为摘要检查点，保留近期尾部和完整工具配对，后续回合从摘要续接；压缩失败不中断原请求 |
| F12.4 | provider 确认超窗后压缩一次再重试；压不动时回合以明确原因失败、AutoRun 暂停；重启后未闭合的压缩记为中断 |
| F12.5 | 提供 Human 主动 `/compact` 命令；复用现有压缩核心，支持独立 Session 事务、上下文解析、串行执行与重启恢复 |
| F12.6 | 桌面能读到 Session 上下文用量、压缩发生记录，并在历史中区分摘要检查点 |
| F12.7 | 用离线长程多回合和真实模型小窗口配置证明 AutoRun 能跨越多次压缩完成 Project |

## 6. 明确不采用

- 工具结果剪枝：Navo 的 fetch / file / shell 工具已在输出端截断，先观察 F12.7 实测是否仍有单个超大结果，再决定是否新增；
- 图片省略：Navo 当前不发送图片输入；
- 独立摘要模型配置：摘要沿用当前 Session 对应的模型；手动 `/compact` 已纳入 F12.5，不再视为明确不采用项；
- 可召回压缩、跨 Session 检索：归入 Phase 13；
- 按路由的 token 定价与 shadow-price 事件：Navo 只有文本输入，启发式 + usage 锚点已经够触发与选区使用。

## 7. 坑与发现

- Qwen adapter 在构造错误前就 `cancel` 了响应体，F12.4 需要先有限读取 400 响应体，才能识别超窗。
- `user-message` 目前只有 `{ message }`；F12.3 增加 `compactionId` 时要同步修改 `history.ts` 的解析校验，并兼容旧日志。
- 压缩锁对账要放进 F10.3 的同一重启恢复流程，并排在未闭合 Turn 收尾之前，保证日志中 `compaction-ended` 先于 `turn-ended`；恢复顺序问题曾有先例（BUG-011，列表回放顺序），需补重启回归测试。

## 8. 下一步

F12.1–F12.4 已有对应实现与记录；F12.3 的本机完整验证仍需按 backend-plan 跟踪。下一步经用户确认进入 F12.5 主动 `/compact` 命令。
