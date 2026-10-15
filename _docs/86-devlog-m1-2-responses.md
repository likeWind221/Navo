# M1.2 Responses 连续对话与工具往返

## 做了什么

2026-10-13 用户授权 squash 合并 M1.1 PR #49，并继续由子 Agent 实施下一步。工作树复用，分支 phase10-m1.2-responses 从合并后的最新 master 349b035 创建，不从旧 M1.1 tip 延伸。

授权范围：公共 Responses 请求/流/原生历史回传、通用流聚合与 Session 助手消息传递，以及离线工具闭环与异常验收。主 Agent 独占文档、完整验证与 Git 收口，开发子 Agent 实施 src 与直接相关 tests，只读审查子 Agent 检查协议完整性。实现已完成，尚未合并。

新增 protocols/responses/request.ts、stream.ts、item.ts、replay.ts、event.ts；修改 llm/types.ts、accumulator.ts、collect.ts、agent/request.ts 与 session/store.ts；新增协议测试和 AgentRuntime 闭环测试。Qwen、Host 装配、认证、前端与 RPC 契约不修改。

## 关键决策

沿用 [84](84-devlog-model-protocol-design.md) 的单向职责。Responses 协议不负责 HTTP 认证或厂商选择；调用方提供 provider/model/tool namespace。原生回传信息随成功助手消息保存，不依赖 Adapter 缓存，不交给桌面展示事件。公共协议可表达的参数与 ChatGPT 订阅的准入限制分开，后者留给 M1.4 接入边界。

- serializeResponsesRequest 将 system 转为有序 developer input，把工具定义分组到调用方指定的 namespace；工具结果按 call_id 关联，不按工具数组次序猜测。stream:true、store:false，无 previous_response_id；协议可表达 temperature/max_output_tokens，订阅禁用策略不放在公共 codec。
- translateResponsesSse 复用 SSE 解帧，以 output_index 定位原生项；text/refusal 的 content_index 与 reasoning 的 summary_index 各自累积。最终 done 值只允许延长已发布前缀，通过 reconcileTextPart/reconcileSummary/reconcileArguments 补尾，冲突报错。首个终态后立即收口；failed、incomplete、缺终态及残缺工具不会成为成功工具执行。
- item.ts 拥有每项的身份与内容状态。upsertItem/applyIdentity 保持 type/id/call_id/name/namespace 不变；startTool 在发布事件前校验 namespace；completeTool 要求实际 output_item.done，参数流结束不替代项结束。正文、摘要和拒绝回答均投影为既有 canonical 内容。
- ReplayEnvelope 只描述版本、protocol 字符串、provider/model 来源及 items；items 的 contentIndex 为 null 时表示无可见内容的原生 reasoning。通用层不解析 payload。replayPayload 去除正文、摘要文字和参数，保留原生辅助信息；request 的 restoreReplay/restoreMessage/restoreReasoning/restoreFunctionCall 从当前 canonical 消息恢复正文和参数，避免第二份文本覆盖会话事实。
- readResponsesReplay 校验协议、版本和来源，Responses 的原生 message/reasoning/function_call 关键字段由所属模块校验。message 顶层 phase 可缺省/null/commentary/final_answer，不强制所有模型输出 phase。固定 provider/model 会话，来源不匹配时报错，不自动降级。
- StepAccumulator 保持原有内容过滤，replay() 同步过滤元数据并把稀疏流索引重映射为最终紧凑内容位置；collectStream 携带该信封，requestModel 写入助手消息。Session 的 eventMessage 保留有 replay 的空正文助手消息，原来无正文也无 replay 的空消息仍过滤，因此 reasoning-only 成功回复也能进入下一次请求。
- Responses 规范失败可标记内部 exposeCode，让已发布内容后的错误保留源诊断码；requestModel 保留 stream-output-interrupted 的不可自动重试语义，并在公开 failure 前剥离内部标志。Qwen/Mock 的默认文案与 RPC 的既有展示字段不变。

stream.ts（291 行）与 item.ts（253 行）分别拥有整次响应编排与项状态，不再继续拆出无语义转发层。协议测试 301 行保留在单个文件：它验证同一请求—响应—回传能力，大部分篇幅是相互关联的原生 fixture，没有独立生产状态机；Agent/Session 跨层场景另在 agent/responses.spec.ts。

Harness 参考沿用已核对的官方快照 d743267388641bc76f17c45ce8b4c231aed1d32c：llm/src/types.ts 的 ReplayEnvelope、llm/src/assembler.ts 的同步内容裁剪与 llm-deepseek/src/replay.ts 的来源/版本/块校验。采用不透明回传与所有者校验；不采用动态提供商框架、自动降级、额外重试或 Messages transport。

## 坑与发现

原生 encrypted reasoning 即使没有可见摘要仍须保留；工具参数不完整或响应未成功时不能执行工具。Session 重启持久化与订阅认证均未在本步授权。

首次完整检查暴露旧 Host 错误文案回归：统一追加源码会改变 Qwen/Mock 的既有断言，已用内部显式标志修正，没有通过改旧断言绕过。审查还修正了 raw replay 覆盖 canonical、缺 output_item.done 放行工具、多内容段被当作整体前缀、仅在 done 出现的 reasoning 丢失和 phase 被误当必填字段。只读审查对子段与 refusal 做 Node24 最小复现后确认无阻塞。

开发期间 F10.1d PR #50 合入主线，因此实现从最初 349b035 重基到最新 master 9d5b580；保留该次持久化代码与计划更新，不覆盖它们。88 号记录已先分配给 M1.2，F10.1d 的独立记录为 89。

## 验证结果与边界

环境：Windows PowerShell、Node 24.19.0、pnpm 10.33.0。pnpm typecheck 通过；子 Agent 最后修订的 4 个相关文件、33 项测试通过；主 Agent 在最新 master 9d5b580 上运行 pnpm test：91 个文件、554 项全部通过（27.57 秒）。git diff --check 通过。本轮没有依赖变更。

离线覆盖：纯文本、多内容段、refusal、summary done、隐藏 encrypted reasoning、工具参数补尾及冲突、缺 item done、首终态唯一、失败/incomplete/断流；实际 LLMService + AgentRuntime + Session + test_echo 工具往返，重建测试 Adapter 后下一请求恢复原生 ID、phase、namespace、call_id 与结果；reasoning-only 回复进入后续请求；取消不执行工具。

未调用真实模型、未读取凭据、未占用 GPU。当前只证明离线协议与内存 Session 往返，不证明账号准入、真实 HTTP 认证/连接取消、订阅字段兼容或旧会话进程重启恢复。CI 以独立 PR 最新 head 的 checks 为准。

## 下一步

2026-10-13 用户明确授权合并后，[PR #51](https://github.com/likeWind221/Navo/pull/51) 在最新 head 941a49c 的 CI verify 成功（56 秒）后 squash 合入，master 提交为 c27dd34。M1.2 更新为 ✅；下一功能为 M1.3 本机订阅授权与账号模型查询，需单独确认范围，M1.3/M1.4 不提前实现。

M1.2 收口交接：该步授权仅 M1.2，文件与验证见本记录；代码导读已交付。Responses 已有公共 codec 与消息传递，但生产 OpenAIAdapter、OAuth、Host 选择和前端尚未落实。
