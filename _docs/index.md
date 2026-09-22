# 文档索引

## 产品与计划

- [Navo PRD](00-navo-prd.md)：当前项目产品定义；核心为 Adaptive Roadmap、Execution、Verification 与 Replanning，Research Workspace 为首个重点应用。
- [SkillWorld PRD 历史入口](00-skillworld-prd.md)：旧链接兼容入口；原 v0.6 PRD 已归档。
- [SkillWorld v0.6 PRD 归档](48-legacy-skillworld-prd.md)：Phase 0–8 的原始 Learning-first / DAG 设计历史。
- [后端 Agent 内核开发计划](backend-plan.md)：后端阶段、步骤、状态和验收标准。
- [前端开发计划](frontend-plan.md)：Electron + React 前端阶段、步骤、状态和验收标准。
- [后端开发进度总览](19-backend-progress.md)：当前已完成能力、架构、验收和后续阶段。
- [前端开发进度总览](20-frontend-progress.md)：当前桌面链路、Renderer 状态、QA 和后续边界。
- [前端信息架构](12-frontend-information-architecture.md)：页面目标、路由、Node 工作区和权限边界。
- [视觉设计规范](14-visual-design.md)：主题、色板、排版、组件和无障碍要求。
- [模块分文件架构审核](16-module-file-architecture-review.md)：当前各包文件粒度、保留项与收敛建议。
- [源码目录与命名整理方案](23-structure.md)：后端、RPC、前端的模块目录、单词命名与逐文件映射；已实施。

## 后端阶段记录

- [内存路线图与数据库持久化阶段划分](56-devlog-persistence-plan.md)：区分重建、落盘和恢复；F9.3 完成内存路线图，F10 统一实施数据库持久化；附 Codex/Pi 存储调研与数据库选型。

- [F9.1–F9.2：Project 与通用 Node 领域](55-devlog-project-node-domain.md)：项目身份与事件恢复、通用节点、四态生命周期和人工完成确认。
- [F9.3：In-Memory Roadmap](59-devlog-f9.3-roadmap.md)：整合图结构、required/optional、RoadmapStore、Node 五态、依赖 lock/unlock、原子变更、历史重建与只读地图查询；旧 Board/Path 方案已收敛。
- [F9.4：Agent Profile 与 Binding](60-devlog-f9.4-agent-profile-binding.md)：Main / Node Profile、可信 Session Binding、归档拒绝与角色/项目越权防护，含本机完整验证结果。
- [F9.5：Main Agent Planning](62-devlog-f9.5-main-agent-planning.md)：整合 read_roadmap、read_node、write_roadmap、modify_roadmap，形成受可信 Binding 与版本校验约束的 Main Roadmap 规划闭环。
- [CI 与 PR 流程接入](61-devlog-ci-pr-flow.md)：GitHub Actions 的 typecheck/test 门禁、Step 分支与 squash 合并约定，以及 CI 暴露的平台测试问题。
- [F9.6：Project Workspace 与 Resource Handoff](63-devlog-f9.6-workspace-resource-handoff.md)：整合 Mailbox、真实 Project Workspace、Resource 生命周期/权限、Main/Node capability、Context Builder、Main handoff 与 Human Gate 端到端验收。
- [F9.7a：ProjectRuntime Core](64-devlog-f9.7a-project-runtime-core.md)：建立 Human-controlled Node start 统一入口，复用 Node 五态与 AgentRuntime，并以瞬时 reservation 阻止同 Node 双重 Human start。

- [F9.7b：Main / Node 人工执行控制](65-devlog-f9.7b-human-control.md)：统一显式启动、后续回合、定向取消及人工完成/跳过，保留既有会话与领域状态。

- [F9.7c：异常恢复与执行收口](66-devlog-f9.7c-runtime-recovery.md)：验证失败、取消、归档和服务释放，修复并行卸载时的回合清理，并以 ProjectRuntime 验证资源交接人工 Gate。

- [F9.8：长程 Core 集成验收](67-devlog-f9.8-longterm-acceptance.md)：离线人工回合闭环通过；追加真实 Qwen 验收记录，续接资源发现与工具调用稳定性仍待收尾。

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
- [阶段 8：通用文件工具与网页结果留存（合并记录）](21-devlog-phase-8-file-tools-plan.md)：整合协议演进、Pi/DSH 调研、read/shell/edit/write、Fetch spill、版本并发安全、装配修复与最终验收。
- [F2.2：Backend Kernel Host 与真实模型](17-devlog-step-f2-2-kernel-host.md)：记录 Qwen SSE Adapter、Agent Runtime 实时正文出口、stdio RPC Host、Mock Host 与生命周期验收。

## 前端记录

- [F0.1：桌面前端骨架](11-devlog-step-f0-1-frontend-scaffold.md)
- [阶段 F1：前端信息架构与静态工作区收口](13-devlog-phase-f1-frontend.md)：合并记录信息架构、视觉探索、最小样板、对话工作区、Qwen 可行性核实和 Electron 交互验收。
- [阶段 F2：Electron 接入 Agent 与真实流式对话](15-devlog-phase-f2-agent-integration.md)：整合规划、公共 RPC、Main 生命周期、Preload 安全桥、Renderer 状态、流式 UI、桌面验收与 F3 承接边界；链接保留的 F2.2 后端记录。
- [F3.1：公共事件契约](22-devlog-step-f3-1-public-events.md)：助手有序内容块、独立命令通知流、身份与终态校验、兼容及后端交接。
- [源码目录与命名重构实施记录](24-structure.md)：77 条路径迁移、RPC 与共享契约拆分、用户偏好记忆和 278 项测试及 Electron 验收。
- [计划功能性描述重写与 F3.2 拆分](25-devlog-plan-functional-rewrite.md)：计划步骤改为功能性目标描述、CLAUDE.md 新增撰写原则、F3.2 拆为四个功能子步骤并确定 /hello 占位命令。
- [F3.2.1：助手内容事件接通与链路收敛](26-devlog-f3-2-1-assistant-content-events.md)：ModelEvent 单点分叉、StepAccumulator 唯一聚合、TurnEvent 实时路径、超时与残缺工具收敛、全业务事件资源预算及 stdio 坏帧恢复。
- [F3.2.1.2：工具能力归属收敛](27-devlog-f3-2-tool-policy.md)：RPC 不选择工具、Runtime 缺省关闭能力、Schema 与执行共用内核白名单，领域 Agent 保留精确 Profile。
- [F3.2.1.3：统一回合观察事件](28-devlog-unified-turn-events.md)：内核直接生成唯一 TurnEvent，Host 原样转交，RPC 校验与封帧；当前事件架构及兼容、取消边界。
- [F3.2.2：工具执行事件接通](29-devlog-tool-events.md)：内核组装工具参数并发布真实执行与有界结果，覆盖拒绝、失败、取消和截断时序。
- [F3.2.3：会话命令流与 `/hello`](31-devlog-f3-2-3-command-framework.md)：内核命令注册与调度、统一 CommandEvent、回合锚点及独立 RPC 命令流。
- [F3.2.4：Mock Host 与端到端回归](32-devlog-f3-2-4-mock-host-e2e.md)：独立进程装配回合与命令 RPC，验证 stdio 帧、客户端消费、取消和 Host 生命周期。
- [F3.3：桌面桥接与会话状态](33-devlog-f3-3-desktop-bridge-state.md)：Electron v2/command bridge、Preload 校验与 Renderer 会话状态归并。
- [F3.4：助手内容展示](34-devlog-f3-4-assistant-content-display.md)：按内容块顺序展示正文、折叠 reasoning、工具调用卡片及其结果状态。
- [F3.5：命令入口与通知展示](35-devlog-f3-5-command-notifications.md)：斜杠命令专用提交、会话系统提示行及执行中/成功/失败/取消状态。
- [F3.6：完整链路验收](36-devlog-f3-6-full-chain-acceptance.md)：Electron Mock 全链路、真实 Host 文本回合、真实工具/命令、命令错误、并发回合、取消、Host 生命周期和人工桌面体验验收结果。
- [Exa Search 接入真实 Host](37-devlog-exa-host-wiring.md)：Host 按环境密钥装配 Exa adapter、向 turn 传递 `web_search` 白名单，并补充启动脱敏与配置测试。
- [F3.8：消息列对齐修正](39-devlog-f3-8-message-alignment.md)：对称滚动条槽位消除消息列左偏，并增加 Electron 边界对齐断言。
- [F3.9：滚动区与输入框布局](40-devlog-f3-9-scroll-layout.md)：滚动区延伸至窗口底部，输入区域以不透明底部覆盖层遮挡经过的消息。
- [F3.10：Markdown 消息展示](41-devlog-f3-10-markdown.md)：基于 DSH 的 GFM 语法树到 React 渲染、流式阅读、安全外链与 Electron 自动验收；等待人工确认。
- [F3.11：数学公式展示](42-devlog-f3-11-math.md)：两套语法区分生成中与结束后、KaTeX 行内/块级公式、无效公式与危险命令边界、宽公式内部滚动及 Electron 自动验收。
- [ChatGPT / Codex 式过程 UI 开源参考调研](43-devlog-chatgpt-codex-ui-research.md)：ai-elements、assistant-ui、lobehub、openai/codex 的思考/工具/过程折叠实现对比、许可证与可借鉴机制。
- [F4 过程 UI 实施方案](44-process-ui-design.md)：以 LobeHub 为基准的回合过程分组、折叠状态、流式标题、计时与自绘图标库设计。
- [F4.1：过程图标库](45-devlog-f4-1-icons.md)：九枚自绘图标、入口与单图标文件的职责划分、预览页演示与 Electron 渲染断言。
- [图标库选型调研](46-devlog-icon-library-research.md)：reicon 与 lucide 的许可、体量、绘图一致性实测对比，结论为本阶段继续使用自绘图标。
- [F4.2：回合过程折叠](47-devlog-f4-2-process-fold.md)：过程与最终回答切分、折叠判据、回合起止时间、真实 IPC 桌面验收与三处实现坑。
- [F4.3：过程状态栏、顺序过程流与用时](50-devlog-f4-3-process-flow.md)：固定处理状态与实时/冻结用时、reasoning 摘要、Shell 过程标题、最终回答前折叠边界，以及后续由 F4.4 补齐的自动验收。
- [F4 实现汇总](52-devlog-f4-4-text-process.md)：合并文本过程、活动行、工具结果、图标流光与单 HTML 演示实现。
- [Host 工具列表排查](53-devlog-message-demo-tool-audit.md)：工具配置与模型白名单的只读诊断结论。
- [F4 验收与收尾](54-devlog-tool-result-rows.md)：自动验证与用户验收通过，阶段正式关闭。

## 项目迁移记录

- [Navo 品牌迁移](49-devlog-navo-brand-migration.md)：SkillWorld → Navo 的 package、应用标识、环境变量、IPC、UI 与文档迁移边界。

## 研究与自动审查

- [F3.7：思考内容修正](38-devlog-f3-7-reasoning.md)：Host 默认启用 thinking，Qwen Adapter 对齐真实 reasoning 字段，记录模型冒烟与展示复验边界。
- [DeepSeek Harness 参考分析](01-deepseek-harness-单对话核心与最小-agent-闭环设计.md)
- [Codex 提交审查](codex-reviews/)：历史 post-commit 审查报告（以“阶段 + 中文标题 + 短 SHA”命名）归档；post-commit 审查钩子（`.githooks/`）已移除，后续提交不再生成新报告。
- [F3.2.3 命令调度设计记录](30-devlog-command-scheduling-design.md)：记录命令旁路与排队两种执行路径、会话工作队列及回合锚点的设计方向。

- [F5.1 工作区布局与导航](57-devlog-f5-1-workspace.md)：侧栏双视图、顶部标签、状态保留与滑动过渡。

- [F5.2 真实项目入口接入核对](58-devlog-f5-2-project-handoff.md)：公共项目接口缺口、领域字段边界与后端交接目标。
