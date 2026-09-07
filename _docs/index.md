# 文档索引

## 产品与计划

- [SkillWorld 简化 PRD](00-skillworld-prd.md)：系统核心定义与产品原则。
- [后端 Agent 内核开发计划](backend-plan.md)：后端阶段、步骤、状态和验收标准。
- [前端开发计划](frontend-plan.md)：Electron + React 前端阶段、步骤和验收标准。
- [后端开发进度总览](19-backend-progress.md)：当前已完成能力、架构、验收和后续阶段。
- [前端开发进度总览](20-frontend-progress.md)：当前桌面链路、Renderer 状态、QA 和后续边界。
- [前端信息架构](12-frontend-information-architecture.md)：页面目标、路由、Node 工作区和权限边界。
- [视觉设计规范](14-visual-design.md)：主题、色板、排版、组件和无障碍要求。
- [模块分文件架构审核](16-module-file-architecture-review.md)：当前各包文件粒度、保留项与收敛建议。

- [源码目录与命名整理方案](24-structure.md)：后端、RPC、前端的模块目录、单词命名与逐文件映射；已实施。

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
- [阶段 7：Fetch 网页读取与调研闭环（合并记录）](18-devlog-phase-7-fetch.md)
- [阶段 8：通用文件工具与网页结果留存规划](21-devlog-phase-8-file-tools-plan.md)：Pi 式 read/find/write/edit、Session 工作区与 Fetch spill。
- [F2.2：Backend Kernel Host 与真实模型](17-devlog-step-f2-2-kernel-host.md)：记录 Qwen SSE Adapter、Agent Runtime 实时正文出口、stdio RPC Host、Mock Host 与生命周期验收。

- [8.1：文件工具协议与稳定错误](22-devlog-step-8-1-file-protocol.md)

## 前端记录

- [F0.1：桌面前端骨架](11-devlog-step-f0-1-frontend-scaffold.md)
- [阶段 F1：前端信息架构与静态工作区收口](13-devlog-phase-f1-frontend.md)：合并记录信息架构、视觉探索、最小样板、对话工作区、Qwen 可行性核实和 Electron 交互验收。
- [阶段 F2：Electron 接入 Agent 与真实流式对话](15-devlog-phase-f2-agent-integration.md)：整合规划、公共 RPC、Main 生命周期、Preload 安全桥、Renderer 状态、流式 UI、桌面验收与 F3 承接边界；链接保留的 F2.2 后端记录。

- [F3.1：公共事件契约](23-devlog-step-f3-1-public-events.md)：助手有序内容块、独立命令通知流、身份与终态校验、兼容及后端交接。

- [源码目录与命名重构实施记录](25-structure.md)：77 条路径迁移、RPC 与共享契约拆分、用户偏好记忆和 278 项测试及 Electron 验收。

## 研究与自动审查

- [DeepSeek Harness 参考分析](01-deepseek-harness-单对话核心与最小-agent-闭环设计.md)
- [Codex 提交审查](codex-reviews/)：以“阶段 + 中文标题 + 短 SHA”命名的 post-commit 报告。
