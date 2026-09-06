# 文档索引

## 产品与计划

- [SkillWorld 简化 PRD](00-skillworld-prd.md)：系统核心定义与产品原则。
- [后端 Agent 内核开发计划](backend-plan.md)：后端阶段、步骤、状态和验收标准。
- [前端开发计划](frontend-plan.md)：Electron + React 前端阶段、步骤和验收标准。
- [前端信息架构](21-frontend-information-architecture.md)：页面目标、路由、Node 工作区和权限边界。
- [视觉设计规范](24-visual-design.md)：主题、色板、排版、组件和无障碍要求。
- [模块分文件架构审核](42-module-file-architecture-review.md)：当前各包文件粒度、保留项与收敛建议。

## 后端阶段记录

- [阶段 0：工程骨架](02-阶段-0-工程骨架开发记录.md)
- [阶段 1：核心协议](03-devlog-phase-1-core-protocol.md)
- [阶段 2：SessionLog 与消息投影](04-devlog-phase-2-session-log.md)
- [阶段 3：LLM 与工具服务](05-devlog-phase-3-llm-tools.md)
- [阶段 4：Agent Runtime](06-devlog-phase-4-agent-runtime.md)
- [阶段 5.1：最小应用组合](07-devlog-phase-5-app-composition.md)
- [阶段 5.2：闭环集成测试](08-devlog-phase-5-loop-integration.md)
- [版本收口记录](09-devlog-version-closure.md)
- [阶段 6：Node 学习内容闭环](10-devlog-phase-6-node-learning.md)：整合原 Step 6.1–6.15 的契约、实现、取舍和验收。
- [阶段 7.0：Search Tool 边界收缩](41-devlog-step-7-0-search-tool-boundary.md)
- [阶段 7.1：Fetch 公共协议与错误](43-devlog-step-7-1-fetch-protocol.md)：不定义 Adapter 或 Cordis Service，后续由 Tools 根内部的 FetchCore 实现。
- [阶段 7.2：FetchCore 与校验边界](44-devlog-step-7-2-fetch-core.md)：记录内部普通 Core、配置/请求/结果校验、有界冻结、超时、取消与迟到结果收敛。
- [阶段 7.3：URL 与公共网络策略](46-devlog-step-7-3-fetch-network-policy.md)：记录 URL 预检、公共 IP/NAT64 判定、完整 DNS 集校验和 Undici 固定连接。
- [阶段 7.4：HTTP Fetch 实现](47-devlog-step-7-4-http-fetch.md)
- [阶段 7.5：Mock FetchCore](48-devlog-step-7-5-mock-fetch-core.md)
- [阶段 7.6：HTML 转换与 FetchTool](49-devlog-step-7-6-fetch-tool.md)
- [阶段 7.7：Tools 与 Node 接入](50-devlog-step-7-7-fetch-integration.md)
- [阶段 7.8.1：FetchCore 与网络测试](51-devlog-step-7-8-1-fetch-core-network-tests.md)
- [阶段 7.8.2：HTTP 与工具测试](52-devlog-step-7-8-2-fetch-http-tool-tests.md)
- [阶段 7：Fetch 调研闭环收口](53-devlog-phase-7-fetch.md)
- [阶段 7.9：Harness 风格完整 Fetch](59-devlog-step-7-9-complete-fetch.md)：超限失败而非截断，后续再独立实现 spill + read。
- [F2.2：Backend Kernel Host 与真实模型](45-devlog-step-f2-2-kernel-host.md)：记录 Qwen SSE Adapter、Agent Runtime 实时正文出口、stdio RPC Host、Mock Host 与生命周期验收。

## 前端记录

- [F0.1：桌面前端骨架](18-devlog-step-f0-1-frontend-scaffold.md)
- [阶段 F1：前端信息架构与静态工作区收口](22-devlog-phase-f1-frontend.md)：合并记录信息架构、视觉探索、最小样板、对话工作区、Qwen 可行性核实和 Electron 交互验收。
- [F2：Electron 接入 Agent 规划](34-devlog-step-f2-agent-integration-plan.md)
- [F2.1：通用 Stream RPC MVP](38-devlog-step-f2-1-stream-rpc.md)
- [F2.3：Main Host 生命周期与传输](54-devlog-step-f2-3-main-host-lifecycle.md)：记录 Electron Main 的单 Host 管理、stdio Client Transport、日志脱敏、取消与进程退出验收。
- [F2.4：Preload 最小安全桥](55-devlog-step-f2-4-preload-agent-bridge.md)：记录固定 Agent Turn IPC、Preload 受限 API、更新校验、取消归属与订阅清理。
- [F2.5：Renderer 对话状态内核](56-devlog-step-f2-5-renderer-conversation-state.md)：记录对话 reducer、Bridge Hook、增量拼接、请求隔离与终态收敛。
- [F2.6：流式对话界面](57-devlog-step-f2-6-streaming-chat-ui.md)：记录真实 Agent UI 接线、等待与流式状态、停止交互、滚动保护及 Mock/真实 Host 验收。
- [F2.7：错误与桌面验收](58-devlog-step-f2-7-error-desktop-acceptance.md)：记录 IPC 拒绝分类、Turn 超时、Host 异常、终态收敛和完整 Electron 验收。

## 研究与自动审查

- [DeepSeek Harness 参考分析](01-deepseek-harness-单对话核心与最小-agent-闭环设计.md)
- [Codex 提交审查](codex-reviews/)：以“阶段 + 中文标题 + 短 SHA”命名的 post-commit 报告。
