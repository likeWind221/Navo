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
- [8.1 路径语义修订](33-devlog-step-8-1-path-semantics.md)：对齐 DSH 执行世界的 Session `cwd`，支持相对/绝对路径语义并保留后续沙箱边界。
- [8.1 文件工具协议收口](45-devlog-step-8-1-protocol-closure.md)：移除文件工具层独立 `find` 的请求、结果、Schema 和扫描错误文案，保留 `read/write/edit` 契约。
- [8.2.2 纯文本 Read Tool](46-devlog-read-text.md)：DSH 式混合读取、严格 UTF-8、完整行窗口、JSON 保存出口与纯文本投影。
- [8.2.1 工作区定位与文件目标](35-devlog-step-8-2-1-path-target.md)：固定执行工作区 `cwd`，归一化相对/绝对路径、符号链接和缺失目标。
- [8.2.3 Shell Tool](52-devlog-step-8-2-3-shell-tool.md)：执行世界内的有界命令执行、powershell/bash 方言解析、超时与取消的进程树终止、退出码修正与模型投影。
- [8.2.6 工具结果出口收口](54-devlog-step-8-2-6-tool-output.md)：工具结果出口收为单臂 `{ content, artifact? }`，删除死代码数组臂，现有工具统一对齐且模型文本不变。
- [Pi Coding Agent 文件探索机制调研](36-devlog-research-pi-read-discovery.md)：确认默认由 `bash` 完成路径发现，`read` 负责已知路径读取，`find/grep/ls` 为可选工具。

## 前端记录

- [F0.1：桌面前端骨架](11-devlog-step-f0-1-frontend-scaffold.md)
- [阶段 F1：前端信息架构与静态工作区收口](13-devlog-phase-f1-frontend.md)：合并记录信息架构、视觉探索、最小样板、对话工作区、Qwen 可行性核实和 Electron 交互验收。
- [阶段 F2：Electron 接入 Agent 与真实流式对话](15-devlog-phase-f2-agent-integration.md)：整合规划、公共 RPC、Main 生命周期、Preload 安全桥、Renderer 状态、流式 UI、桌面验收与 F3 承接边界；链接保留的 F2.2 后端记录。

- [F3.1：公共事件契约](23-devlog-step-f3-1-public-events.md)：助手有序内容块、独立命令通知流、身份与终态校验、兼容及后端交接。

- [源码目录与命名重构实施记录](25-structure.md)：77 条路径迁移、RPC 与共享契约拆分、用户偏好记忆和 278 项测试及 Electron 验收。
- [计划功能性描述重写与 F3.2 拆分](26-devlog-plan-functional-rewrite.md)：计划步骤改为功能性目标描述、CLAUDE.md 新增撰写原则、F3.2 拆为四个功能子步骤并确定 /hello 占位命令。
- [F3.2.1：助手内容事件接通与链路收敛](27-devlog-f3-2-1-assistant-content-events.md)：ModelEvent 单点分叉、StepAccumulator 唯一聚合、TurnEvent 实时路径、超时与残缺工具收敛、全业务事件资源预算及 stdio 坏帧恢复。
- [F3.2.1.2：工具能力归属收敛](28-devlog-f3-2-tool-policy.md)：RPC 不选择工具、Runtime 缺省关闭能力、Schema 与执行共用内核白名单，领域 Agent 保留精确 Profile。
- [F3.2.1.3：统一回合观察事件](29-devlog-unified-turn-events.md)：内核直接生成唯一 TurnEvent，Host 原样转交，RPC 校验与封帧；当前事件架构及兼容、取消边界。
- [F3.2.2：工具执行事件接通](30-devlog-tool-events.md)：内核组装工具参数并发布真实执行与有界结果，覆盖拒绝、失败、取消和截断时序。
- [F3.2.3：会话命令流与 `/hello`](32-devlog-f3-2-3-command-framework.md)：内核命令注册与调度、统一 CommandEvent、回合锚点及独立 RPC 命令流。
- [F3.2.4：Mock Host 与端到端回归](34-devlog-f3-2-4-mock-host-e2e.md)：独立进程装配回合与命令 RPC，验证 stdio 帧、客户端消费、取消和 Host 生命周期。
- [F3.3：桌面桥接与会话状态](37-devlog-f3-3-desktop-bridge-state.md)：Electron v2/command bridge、Preload 校验与 Renderer 会话状态归并。
- [F3.4：助手内容展示](38-devlog-f3-4-assistant-content-display.md)：按内容块顺序展示正文、折叠 reasoning、工具调用卡片及其结果状态。
- [F3.5：命令入口与通知展示](39-devlog-f3-5-command-notifications.md)：斜杠命令专用提交、会话系统提示行及执行中/成功/失败/取消状态。
- [F3.6：完整链路验收](40-devlog-f3-6-full-chain-acceptance.md)：Electron Mock 全链路、真实 Host 文本回合、真实工具/命令、命令错误、并发回合、取消、Host 生命周期和人工桌面体验验收结果。
- [Exa Search 接入真实 Host](41-devlog-exa-host-wiring.md)：Host 按环境密钥装配 Exa adapter、向 turn 传递 `web_search` 白名单，并补充启动脱敏与配置测试。
- [F3.8：消息列对齐修正](43-devlog-f3-8-message-alignment.md)：对称滚动条槽位消除消息列左偏，并增加 Electron 边界对齐断言。
- [F3.9：滚动区与输入框布局](44-devlog-f3-9-scroll-layout.md)：滚动区延伸至窗口底部，输入区域以不透明底部覆盖层遮挡经过的消息。
- [F3.10：Markdown 消息展示](47-devlog-f3-10-markdown.md)：基于 DSH 的 GFM 语法树到 React 渲染、流式阅读、安全外链与 Electron 自动验收；等待人工确认。
- [F3.11：数学公式展示](48-devlog-f3-11-math.md)：两套语法区分生成中与结束后、KaTeX 行内/块级公式、无效公式与危险命令边界、宽公式内部滚动及 Electron 自动验收。
- [ChatGPT / Codex 式过程 UI 开源参考调研](49-devlog-chatgpt-codex-ui-research.md)：ai-elements、assistant-ui、lobehub、openai/codex 的思考/工具/过程折叠实现对比、许可证与可借鉴机制。
- [F4 过程 UI 实施方案](50-process-ui-design.md)：以 LobeHub 为基准的回合过程分组、折叠状态、流式标题、计时与自绘图标库设计。
- [F4.1：过程图标库](51-devlog-f4-1-icons.md)：九枚自绘图标、入口与单图标文件的职责划分、预览页演示与 Electron 渲染断言。
- [图标库选型调研](53-devlog-icon-library-research.md)：reicon 与 lucide 的许可、体量、绘图一致性实测对比，结论为本阶段继续使用自绘图标。
- [F4.2：回合过程折叠](55-devlog-f4-2-process-fold.md)：过程与最终回答切分、折叠判据、回合起止时间、真实 IPC 桌面验收与三处实现坑。

## 研究与自动审查

- [F3.7：思考内容修正](42-devlog-f3-7-reasoning.md)：Host 默认启用 thinking，Qwen Adapter 对齐真实 reasoning 字段，记录模型冒烟与展示复验边界。

- [DeepSeek Harness 参考分析](01-deepseek-harness-单对话核心与最小-agent-闭环设计.md)
- [Codex 提交审查](codex-reviews/)：以“阶段 + 中文标题 + 短 SHA”命名的 post-commit 报告。
- [F3.2.3 命令调度设计记录](31-devlog-command-scheduling-design.md)：记录命令旁路与排队两种执行路径、会话工作队列及回合锚点的设计方向。
