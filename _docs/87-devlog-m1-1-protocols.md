# M1.1 公共 Chat Completions 协议基础

## 做了什么

用户于 2026-10-13 授权派子 Agent 开发 M1.1。主 Agent 从最新 origin/master（2a9b6d3，F10.1c squash）建立独立工作树与 phase10-m1.1-protocols 分支，负责方案、计划、架构文档、审查、完整验证和 PR；子 Agent 只修改协议代码与直接相关测试，不写共享控制面、不提交。

把原 qwen/request.ts、qwen/sse.ts 提取为公共 protocols/completions/request.ts、stream.ts，并拆出 protocols/sse.ts；删除旧文件和运行引用。QwenChatCompletionsAdapter 的公开名称、HTTP 生命周期和既有行为保留。方案与前置调研见 [86](86-devlog-model-protocol-design.md)、[85](85-devlog-chatgpt-provider-research.md)。本轮不实现后续 Responses、replay、OAuth、OpenAIAdapter、Host 选择或前端。

## 关键决策

- Qwen Adapter 在公共序列化结果上附加 chat_template_kwargs.enable_thinking；选定历史 reasoning_content、输入 reasoning 字段、Qwen 错误标签和 qwen-generated 工具 ID 前缀。协议代码不根据 provider 名称判断厂商。
- serializeChatCompletionsRequest 转换消息、工具定义、工具调用与结果，以及原有温度/max_tokens。默认不发送厂商 reasoning 字段；显式 reasoningField 只允许本轮实际使用的 reasoning_content。
- translateChatCompletionsSse 为一次响应拥有内容数组、远端工具 index 与完成状态。ensureTextContent / ensureToolContent 保证首次出现顺序；translateToolCalls 拼接原始参数和工具名，并保持本地 call ID 不变；mapFinishReason / parseUsage 转换完成原因与用量。缺终态仍不产生 finished，交给既有 Runtime 判断断流；max-tokens/content-filter 仍不完成残缺工具。
- readSseData 只拥有字节解码、缓冲区与 reader：takeEvents 按空行分帧，eventData 合并 data 行；保留固定 1,048,576 字符预算和 UTF-8 fatal 解码，finally 取消未耗尽 reader 并释放锁。它不识别工具、usage 或终态。
- 审查后移除无当前需求的可配置 maxEventChars 和任意字符串索引签名，保持具体选项而非通用兼容框架。210 行协议状态机内聚于同一响应，无多个独立生命周期，不需要进一步拆分。
- 新增直接协议测试，验证同一含 reasoning 历史在默认模式不输出扩展字段；第二套流配置不启用 Qwen reasoning，生成另一前缀工具 ID。它证明协议可独立复用，不声称已接入另一个真实厂商。

### Harness 参考

采用方案 86 已只读核对的官方快照 d743267388641bc76f17c45ce8b4c231aed1d32c：packages/llm/llm-deepseek/src/adapter.ts 组合 serialize、parseSse、translate 并拥有认证与连接取消；Navo 使用相同职责方向，保留现有 LLMService/LLMAdapter 和模型 deadline。本轮不采用其 Messages transport、文件上传、扩展机制、降级或新增 watchdog。公共协议目录是 Navo 针对后续厂商复用的组织选择，不声称与 Harness 目录完全一致。

## 坑与发现

- 默认 PATH 为 Node 22.23.1，项目要求 Node >=24。子 Agent 首次目标检查在 Node 22 通过；主 Agent 改用 bundled Node 24.19.0 后完整检查通过，子 Agent 的最终修订也在 Node 24 验证。
- 当前架构文档 16 已同步；文档 23 的旧路径属于历史迁移映射，79 的旧函数名属于历史 Bug 证据，保留历史记录，不把它们当成运行引用。
- 原工作区的 AGENTS.md 用户改动与未提交文档均保留；新工作树只携带本次调研/方案，不带入用户的 AGENTS.md 改动或 F10.1c 分支历史。

## 验证

环境：Windows PowerShell，Node 24.19.0，pnpm 10.33.0。使用根锁文件安装依赖，未修改包清单或锁文件。

- pnpm typecheck：通过。
- pnpm exec vitest run tests/llm/adapters/qwen.spec.ts tests/llm/protocols/completions.spec.ts：2 文件、12 测试通过。
- pnpm test：89 个测试文件、530 项测试全部通过；最终修订后完整检查耗时 38.55 秒。
- rg 检查 src/tests/scripts 的旧 qwen/request、qwen/sse 及旧函数/常量：无运行引用。
- git diff --check：通过。

仅使用离线响应与 Mock，未调用真实模型、未占用 GPU、未读取订阅凭据。代码提交为 17f1900；独立交付见 [PR #49](https://github.com/likeWind221/Navo/pull/49)，CI 与合并结果以该 PR 的 checks 和合并记录为准，不把本机通过写成 CI 通过。

## 下一步

2026-10-13 用户明确授权合并后，PR #49 在最新 head 20cbc3b 的 CI verify 成功（耗时 1 分 1 秒）后 squash 合入，master 提交为 349b035。M1.1 更新为 ✅；代码导读已交付。用户同时授权继续由子 Agent 实施 M1.2，记录见 [88](88-devlog-m1-2-responses.md)。M1.3–M1.4 不自动开始，当前持久化主线仍为 F10.1d。

M1.1 收口交接：该步授权仅 M1.1，修改文件见本记录；生产协议、Qwen 和相关测试已完成，代码导读与实际验证边界已交付。收口时 Responses/replay/认证契约未落实；随后用户授权的 M1.2 由记录 88 接续，不改变 M1.1 的历史范围。
