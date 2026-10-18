# 文档索引

编号连续，删除或合并文档后后续编号依次前移；整理前后编号对照见 [20](20-devlog-docs-reorganization.md)。

## 产品与计划

- [Navo PRD](00-navo-prd.md)：当前项目产品定义；核心为 Adaptive Roadmap、Execution、Verification 与 Replanning，Research Workspace 为首个重点应用。
- [SkillWorld v0.6 PRD 归档（Navo 前身）](48-legacy-skillworld-prd.md)：Phase 0–8 的原始 Learning-first / DAG 设计历史。
- [后端 Agent 内核开发计划](backend-plan.md)：后端阶段、步骤、状态和验收标准。
- [前端开发计划](frontend-plan.md)：Electron + React 前端阶段、步骤、状态和验收标准。
- [Bug 跟踪与修复计划](bug-plan.md)：待定位、待修复与已修复状态，逐项关闭条件和修复笔记入口。

## 后端 Phase 0–8 与桌面接入

- [阶段 0：工程骨架](02-devlog-phase-0-scaffold.md)
- [阶段 1：核心协议](03-devlog-phase-1-core-protocol.md)
- [阶段 2：SessionLog 与消息投影](04-devlog-phase-2-session-log.md)
- [阶段 3：LLM 与工具服务](05-devlog-phase-3-llm-tools.md)
- [阶段 4：Agent Runtime](06-devlog-phase-4-agent-runtime.md)
- [阶段 5.1：最小应用组合](07-devlog-phase-5-app-composition.md)
- [阶段 5.2：闭环集成测试](08-devlog-phase-5-loop-integration.md)
- [版本收口记录](09-devlog-version-closure.md)
- [阶段 6：Node 学习内容闭环](10-devlog-phase-6-node-learning.md)：整合原 Step 6.1–6.15 的契约、实现、取舍和验收。
- [F2.2：Backend Kernel Host 与真实模型](17-devlog-step-f2-2-kernel-host.md)：记录 Qwen SSE Adapter、Agent Runtime 实时正文出口、stdio RPC Host、Mock Host 与生命周期验收。
- [阶段 7：Fetch 网页读取与调研闭环（合并记录）](18-devlog-phase-7-fetch.md)
- [桌面工具可用性排查](19-devlog-tool-availability.md)：原后端计划第 12 节维护记录；普通桌面回合工具白名单、系统提示词排查与文件工具默认启用修复。
- [阶段 8：通用文件工具与网页结果留存（合并记录）](21-devlog-phase-8-file-tools-plan.md)：整合协议演进、Pi/DSH 调研、read/shell/edit/write、Fetch spill、版本并发安全、装配修复与最终验收。
- [Exa Search 接入真实 Host](37-devlog-exa-host-wiring.md)：Host 按环境密钥装配 Exa adapter、向 turn 传递 `web_search` 白名单，并补充启动脱敏与配置测试。
- [F3.7：思考内容修正](38-devlog-f3-7-reasoning.md)：Host 默认启用 thinking，Qwen Adapter 对齐真实 reasoning 字段，记录模型冒烟与展示复验边界。

## 后端 Phase 9

- [Phase 9 设计记录](51-devlog-phase-9-project-runtime-design.md)：从 Roadmap + Scheduler + Coordinator 调整为 Project + Main Agent + Roadmap + 隔离 Node Agent 的架构收口与取舍。
- [F9.1–F9.2：Project 与通用 Node 领域](55-devlog-project-node-domain.md)：项目身份与事件恢复、通用节点、四态生命周期和人工完成确认。
- [内存路线图与数据库持久化阶段划分](56-devlog-persistence-plan.md)：区分重建、落盘和恢复；F9.3 完成内存路线图，F10 统一实施数据库持久化；附 Codex/Pi 存储调研与数据库选型。
- [F9.3：In-Memory Roadmap](58-devlog-f9.3-roadmap.md)：整合图结构、required/optional、RoadmapStore、Node 五态、依赖 lock/unlock、原子变更、历史重建与只读地图查询；旧 Board/Path 方案已收敛。
- [F9.4：Agent Profile 与 Binding](59-devlog-f9.4-agent-profile-binding.md)：Main / Node Profile、可信 Session Binding、归档拒绝与角色/项目越权防护，含本机完整验证结果。
- [F9.5：Main Agent Planning](61-devlog-f9.5-main-agent-planning.md)：整合 read_roadmap、read_node、write_roadmap、modify_roadmap，形成受可信 Binding 与版本校验约束的 Main Roadmap 规划闭环。
- [F9.6：Project Workspace 与 Resource Handoff](62-devlog-f9.6-workspace-resource-handoff.md)：整合 Mailbox、真实 Project Workspace、Resource 生命周期/权限、Main/Node capability、Context Builder、Main handoff 与 Human Gate 端到端验收。
- [F9.7a：ProjectRuntime Core](63-devlog-f9.7a-project-runtime-core.md)：建立 Human-controlled Node start 统一入口，复用 Node 五态与 AgentRuntime，并以瞬时 reservation 阻止同 Node 双重 Human start。
- [F9.7b：Main / Node 人工执行控制](64-devlog-f9.7b-human-control.md)：统一显式启动、后续回合、定向取消及人工完成/跳过，保留既有会话与领域状态。
- [F9.7c：异常恢复与执行收口](65-devlog-f9.7c-runtime-recovery.md)：验证失败、取消、归档和服务释放，修复并行卸载时的回合清理，并以 ProjectRuntime 验证资源交接人工 Gate。
- [F9.8：长程 Core 集成验收](66-devlog-f9.8-longterm-acceptance.md)：离线人工回合闭环通过；真实 Qwen 验收经 BUG-001 至 BUG-004 修复后收口（BUG-002 保持未关闭）。
- [Resource 访问级别 project 更名为 public](70-devlog-resource-access-rename.md)：行为不变，明确 public 仅限本 Project 所有工作 Node；无持久化数据，无需迁移。
- [F9.9a 项目查询与创建](71-devlog-f9.9a-project-query.md)：项目名称与列表、5 个 `project.*.v1` 公共方法、`agent.turn.v1` 更名、业务失败经 error 帧转发。
- [F9.9b Human 操作入口](72-devlog-f9.9b-human-control.md)：`project.turn.v1` 复用 v2 事件流式执行 Main / Node 回合、cancel 帧只取消目标回合、`project.node.review.v1` 完成与跳过。
- [F9.9c 变化跟随](73-devlog-f9.9c-project-follow.md)：`project.follow.v1` 先推完整基线再推整份替换帧，各状态所有者在提交点发出 `project/changed`。
- [F9.10 项目目标确认与规划前置](74-devlog-f9.10-goal-confirm.md)：目标可选、`set_project_goal` 与 Roadmap 后锁定、无目标不能规划、Main 规划前须经用户同意，以及真实模型五场景与长程验收。

## 后端 Phase 10

- [F10.0 持久化与验证设计收口](78-devlog-f10-0-design.md)：文末附录合并整理前的 69 号 F10 初始规划（Evidence / Verification 并入 F10、先持久化后验证）；现状盘点与 Harness 持久化/检查点/中断收尾对照；只用 SQLite 并存于 `~/.navo/`（不选 MySQL / Redis 的理由）、写入成功即已提交事务、重启按依赖顺序重放且单个 Project 损坏只隔离、中断回合合成收尾不重试；验证结论只作参考（过期看 Node revision、证据可选）、只读验证者权限、不设完成门禁。已经用户确认。2026-10-15 修订：撤销独立验证者（D7–D9），改由 Main 判断完成（D10），Phase 10 剩余 F10.4 Main 判断节点完成与返工反馈、F10.5 长程集成验收；全自动推进排入 F11、上下文压缩排入 F12、RAG 排入 F13。同日 D11：Node 发完成信号进入待确认、Main 复盘必须给出一次判定（可跳过、返工上限 2 次）、人工 / 全自动共用复盘流程，F10.4 拆为 F10.4a / F10.4b，全自动按 Roadmap 依赖推进并设回合上限与自动暂停。
- [F10.1a 项目与工作目录持久保存](79-devlog-f10-1a-project-persist.md)：SQLite 存储模块（通用事件表 + 绑定表、版本与 application_id 校验、延迟 apply 的原子提交）；Project 写穿透与启动恢复；创建时事件与绑定同事务提交；Workspace 丢失时报告不可用；真实 Host 与 Electron 自带 Node 下的重启验收。
- [F10.1b 节点与 Roadmap 持久保存](81-devlog-f10-1b-roadmap-persist.md)：复用事件表新增 node / roadmap 两类事件；自动解锁提前并入批次，Roadmap 变更与 Node 批次同一事务提交；Node 与 Roadmap 启动恢复；Mock Host 脚本化创建 Roadmap 的真实进程重启验收；退出时执行中的 Node 留给 F10.3 收尾。
- [F10.1c 消息与资源登记持久保存](82-devlog-f10-1c-mailbox-resource-persist.md)：消息与资源事件同步提交、启动恢复、实体刷盘及真实 Host 重启验收。
- [F10.1d 损坏隔离与整体重启验收](87-devlog-f10-1d-recovery-isolation.md)：按 Project 预校验并隔离损坏数据，其他 Project 继续恢复；验证五类数据与 Workspace 绑定共同经历真实 Host 重启。
- [F10.2 会话与执行记录恢复（含 F10.2a）](93-devlog-f10-2-session.md)：合并整理前的 96、97 号记录；Main / Node 会话写穿透、历史与上下文恢复、执行前持久化与跨进程续接（PR #55）；F10.2a 普通会话保存方案与 Harness 对照、v1 数据保留升级、两类损坏隔离与普通会话续接（PR #56）。
- [F10.3 中断处理](94-devlog-f10-3-interruption.md)：启动恢复时确定性收口普通/Main/Node 未闭合 Turn，保守补齐工具结果，并与 working Node 的 work-ended 在同一事务提交；本机完整验证、真实 Host 终止 / 重启验收与代码 head CI 通过，交付见 PR #58。
- [F10.4a 完成信号与待确认](96-devlog-f10-4a-done-signal.md)：Node 用 `submit_completion` 交作业（摘要、产物、逐条自查、未完成事项）后回合立即结束并进入 `submitted`；Human 确认、返工或跳过，返工意见存于 Node 事件并在下一回合开始时送达；工具输出 `endsTurn`；公共契约新增 `submitted`、`submission`、`pendingFeedback` 与 `rework` 动作；Harness goal / structured output 对照。
- [F10.4b Main 核查节点成果与计划调整](97-devlog-f10-4b-main-review.md)：Human 请 Main 复盘某节点；核查清单（线索）+ `fetch_resource` 查产物 + `read_node_turn` 查过程三层按需核查；`submit_review` 唯一判定（完成 / 返工 / 跳过 / 交给 Human），返工上限 2 次、从未执行的节点不能被 Main 判完成、版本过期则拒绝；复盘期间节点被锁；复盘记录随 Project 保存；`project.turn.v1` 新增 review 目标；Harness auto-review 对照；经用户决定免除真实模型五场景验收并标记完成（仅 Qwen 跑通场景 1）。
- [F10.5 F10 长程集成验收](98-devlog-f10-5-rework-loop.md)：离线完整场景覆盖交作业、Main 返工、按意见补做、Main 判完成并调整计划、从未执行的节点不能被判完成和两次重启恢复；`gpt-6-sol` 真实验收在 BUG-010 修复后通过前 6 个回合，第 7–11 回合经用户决定免除，已完成；过程中发现并修复 BUG-011。

## 后端 Phase 11

- [F11.0 自动化流程与自主运行架构设计收口](100-devlog-f11-0-design.md)：收口 manual / auto 与 running / paused 两层状态、Main / Node 自动调度顺序、64 / 32 连续 Auto Run 回合预算、失败 / 取消 / 中断、高风险操作与 Human 接管边界；只修改文档，待用户确认后进入 F11.1。
- [F11.1 AutoRun 最小自动推进闭环](101-devlog-f11-1-autorun.md)：单 Node 多 Turn、自动 Main Review、返工与依赖推进；已合入 master。
- [F11.2 AutoRun 暂停、恢复与失败处理](102-devlog-f11-2-pause-resume.md)：Turn 边界暂停、Resume 新预算窗口、64/32 回合上限、失败/取消/中断/blocked 停止语义与重启安全边界。
- [F11.3 AutoRun 全自动推进公共契约](104-devlog-f11-3-autorun-contract.md)：Host / RPC / Electron 公共契约、Start / Pause / Resume / Get、运行状态 / currentTarget / 停止原因与严格两端校验。
- [F11.4 F11 长程自动化验收](105-devlog-f11-4-autorun-acceptance.md)：离线覆盖返工、暂停、失败、重启后显式 Start；本机 695 项测试与 gpt-6-sol 双节点真实自动完成通过。

## 后端 Phase 12–13

- Phase 12：记忆压缩——Context Meter、Session Compaction、Summary Checkpoint 与长程上下文恢复。
- [F12.0 上下文压缩设计收口](109-devlog-f12-0-design.md)：收口 Context Meter、pressure / overflow / manual 三类触发、工具配对选区、压缩事务与摘要检查点、失败 / 取消 / 中断及与 AutoRun 的衔接；F12.5 主动 `/compact` 已纳入计划。
- [F12.1 Context Meter 与模型容量](110-devlog-f12-1-context-meter.md)：`LLM_CONTEXT_WINDOW` / `LLM_AUTO_COMPACT_LIMIT` 配置、阈值与保留预算公式、usage 锚点加有符号估算差的上下文压力测量，以及 Harness / Codex 对照。
- [F12.2 上下文压力检测与执行接入](111-devlog-f12-2-pressure-integration.md)：请求前压力检查、内部触发事件与执行链路。
- [F12.3 摘要压缩与 Session 检查点](112-devlog-f12-3-compaction.md)：安全选区、摘要生成、检查点安装、历史投影与失败语义。
- [F12.4 超窗恢复与重启对账](113-devlog-f12-4-overflow-recovery.md)：provider 超窗归一、压缩后重试及未闭合事务恢复。
- [F12.5 主动压缩命令 /compact](114-devlog-f12-5-manual-compact.md)：复用现有命令与压缩核心，补齐 Main / Node / 普通 Session 上下文解析、manual 独立事务身份、queued 串行执行和重启恢复；本机 748 项完整测试通过，PR #77 已合入 master（3c464f5）。
- [F12.6 压缩与上下文压力公共契约](115-devlog-f12-6-public-context-contract.md)：三个版本化 Session API、上下文快照与订阅、有效历史分页及摘要检查点标识；生产实现与本机验证完成，Electron Bridge 实际调用通过；[PR #78](https://github.com/likeWind221/Navo/pull/78) head CI 通过并已合入 master（3bf5e10）。
- F12.7 长程压缩验收：验证多次压缩、超窗恢复与重启后的 AutoRun 闭环。
- Phase 13：RAG——Workspace / Resource / Session 检索、权限感知 Retrieval 与 RAG Pipeline。

## 模型接入 M1

- [ChatGPT 订阅模型接入可行性调研](83-devlog-chatgpt-provider-research.md)：对照 Pi 新旧 OpenAI 接入与官方 Sign in with ChatGPT；记录授权、Responses 限制、Navo 适配边界及尚未实测的账号准入。
- [公共模型协议层与 ChatGPT 订阅接入方案](84-devlog-model-protocol-design.md)：提取 Chat Completions、新增 Responses、独立订阅认证与 Host 接入；含不透明 replay、Harness 源码对照及四个实施步骤。
- [M1.1：公共 Chat Completions 协议基础](85-devlog-m1-1-protocols.md)：Qwen 厂商配置与公共请求/流转换分离，共享 SSE 解帧；保留原行为并验证协议独立复用。
- [M1.2：Responses 连续对话与工具往返](86-devlog-m1-2-responses.md)：公共 Responses 请求与流转换、原生历史回传及离线 Session/工具闭环；本机、CI 通过，PR #51 已合并。
- [M1.3 本机订阅授权与账号模型查询](89-devlog-m1-3-chatgpt-auth.md)：独立 OAuth/OIDC、受保护凭据、轮换刷新与登出互斥、账号模型目录；本机、真实账号专项和最新 CI 通过，PR #52 已合并。
- [M1.4 Navo 使用订阅模型完成工作](91-devlog-m1-4-openai.md)：Host 配置与 OpenAIAdapter 接入，gpt-6-luna 真实文本、read 续接、取消、重启凭据复用与主动刷新通过；本机与当前 head CI 通过，PR #54 已合入。

## Bug 跟踪与复盘

- [Bug 跟踪机制与 F9.8 已知问题交接](67-devlog-bug-tracking.md)：BUG-001 至 BUG-004 登记、修复留痕规则及本次带已知问题合并授权。
- [BUG-001 至 BUG-004 长程真实验收排查与修复](68-bugfix-bug-001-004-longterm.md)：证据落盘、续接资源变化通知、Resource 引用加固、通用 system-reminder 与 Main 状态通知、可恢复错误验收口径；13 次真实运行记录，BUG-002 保持未关闭。
- [长程验收四个 Bug 复盘（面试版）](69-interview-longterm-bugs.md)：BUG-001 至 BUG-004 按问题、根因、修复、结果组织的面试可背版本，附 60 秒开场与追问要点。
- [BUG-005 未知工具名报错被误读为权限拦截](76-bugfix-bug-005-unknown-tool.md)：ToolService 先查注册表再判白名单，未知名字返回 `unknown-tool` 与本回合可调用列表；去掉提示词规避后真实复验 5 轮，3 次残缺工具名均同回合恢复。
- [BUG-006 残缺工具名根因定位与修复](77-bugfix-bug-006-malformed-tool-name.md)：原始 SSE 与 logprobs 证明残缺名来自模型在 `write_` 后生成换行，vLLM tool parser 不校验函数名，适配层未参与；温度与重命名对照实验；`write_roadmap` 改名为 `create_roadmap` 后受控对照 6/6 降到 0/6，全流程仅 1 次残缺名且同回合恢复。
- [BUG-008 shell 取消后进程树漏杀](80-bugfix-bug-008-shell-cancel.md)：已修复。2026-10-11 CI 诊断取证未复现；2026-10-12 本机冷启动复现，证实 `taskkill /T` 漏杀 pwsh 正在创建的子进程；改为 shell 先进入 `KILL_ON_JOB_CLOSE` 作业再执行命令，并加 1 秒排空兜底；含漏杀对照、单条命令耗时、冷启动多轮与 CI 结果，以及“后台进程随命令结束”的行为变化。
- [BUG-009 Responses namespace 必填描述](92-bugfix-bug-009-namespace.md)：真实 HTTP 400 的定位、最小协议补齐及回归边界。
- [BUG-010 Roadmap 工具参数与运行时约束不一致](95-bugfix-bug-010-roadmap-schema.md)：gpt-6-luna 无法创建 Roadmap 的根因、双数组扁平参数尝试与 Qwen 首调合法率对照（14/15 → 12/15，已回退），后续候选方向，以及 2026-10-15 删除控制节点、拆分 Roadmap 修改工具的修复与 gpt-6-luna / gpt-6-sol 真实复验（规划与改计划通过，Qwen 与 Electron 验收待本机）。
- [BUG-011 重启后节点与资源列表顺序改变](99-bugfix-bug-011-restart-order.md)：恢复时按 UUID 读取导致列表顺序改变的证据与修复；事件历史改按 owner 首条事件的写入顺序回放，附重启顺序回归测试。

## 前端设计规范

- [前端信息架构](12-frontend-information-architecture.md)：页面目标、路由、Node 工作区和权限边界。
- [视觉设计规范](14-visual-design.md)：主题、色板、排版、组件和无障碍要求。
- [F4 过程 UI 实施方案](44-process-ui-design.md)：以 LobeHub 为基准的回合过程分组、折叠状态、流式标题、计时与自绘图标库设计。

## 前端记录

- [F0.1：桌面前端骨架](11-devlog-step-f0-1-frontend-scaffold.md)
- [阶段 F1：前端信息架构与静态工作区收口](13-devlog-phase-f1-frontend.md)：合并记录信息架构、视觉探索、最小样板、对话工作区、Qwen 可行性核实和 Electron 交互验收。
- [阶段 F2：Electron 接入 Agent 与真实流式对话](15-devlog-phase-f2-agent-integration.md)：整合规划、公共 RPC、Main 生命周期、Preload 安全桥、Renderer 状态、流式 UI、桌面验收与 F3 承接边界；链接保留的 F2.2 后端记录。
- [F3.1：公共事件契约](22-devlog-step-f3-1-public-events.md)：助手有序内容块、独立命令通知流、身份与终态校验、兼容及后端交接。
- [F3.2.1：助手内容事件接通与链路收敛](26-devlog-f3-2-1-assistant-content-events.md)：ModelEvent 单点分叉、StepAccumulator 唯一聚合、TurnEvent 实时路径、超时与残缺工具收敛、全业务事件资源预算及 stdio 坏帧恢复。
- [F3.2.1.2：工具能力归属收敛](27-devlog-f3-2-tool-policy.md)：RPC 不选择工具、Runtime 缺省关闭能力、Schema 与执行共用内核白名单，领域 Agent 保留精确 Profile。
- [F3.2.1.3：统一回合观察事件](28-devlog-unified-turn-events.md)：内核直接生成唯一 TurnEvent，Host 原样转交，RPC 校验与封帧；当前事件架构及兼容、取消边界。
- [F3.2.2：工具执行事件接通](29-devlog-tool-events.md)：内核组装工具参数并发布真实执行与有界结果，覆盖拒绝、失败、取消和截断时序。
- [F3.2.3：命令调度设计与会话命令流 `/hello`](31-devlog-f3-2-3-command-framework.md)：合并整理前的 30 号设计记录；命令旁路与排队两种路径、会话工作队列与回合锚点的设计，以及内核命令注册与调度、统一 CommandEvent、独立 RPC 命令流的实现。
- [F3.2.4：Mock Host 与端到端回归](32-devlog-f3-2-4-mock-host-e2e.md)：独立进程装配回合与命令 RPC，验证 stdio 帧、客户端消费、取消和 Host 生命周期。
- [F3.3：桌面桥接与会话状态](33-devlog-f3-3-desktop-bridge-state.md)：Electron v2/command bridge、Preload 校验与 Renderer 会话状态归并。
- [F3.4：助手内容展示](34-devlog-f3-4-assistant-content-display.md)：按内容块顺序展示正文、折叠 reasoning、工具调用卡片及其结果状态。
- [F3.5：命令入口与通知展示](35-devlog-f3-5-command-notifications.md)：斜杠命令专用提交、会话系统提示行及执行中/成功/失败/取消状态。
- [F3.6：完整链路验收](36-devlog-f3-6-full-chain-acceptance.md)：Electron Mock 全链路、真实 Host 文本回合、真实工具/命令、命令错误、并发回合、取消、Host 生命周期和人工桌面体验验收结果。
- [F3.8：消息列对齐修正](39-devlog-f3-8-message-alignment.md)：对称滚动条槽位消除消息列左偏，并增加 Electron 边界对齐断言。
- [F3.9：滚动区与输入框布局](40-devlog-f3-9-scroll-layout.md)：滚动区延伸至窗口底部，输入区域以不透明底部覆盖层遮挡经过的消息。
- [F3.10：Markdown 消息展示](41-devlog-f3-10-markdown.md)：基于 DSH 的 GFM 语法树到 React 渲染、流式阅读、安全外链与 Electron 自动验收；等待人工确认。
- [F3.11：数学公式展示](42-devlog-f3-11-math.md)：两套语法区分生成中与结束后、KaTeX 行内/块级公式、无效公式与危险命令边界、宽公式内部滚动及 Electron 自动验收。
- [F4.1：过程图标库](45-devlog-f4-1-icons.md)：九枚自绘图标、入口与单图标文件的职责划分、预览页演示与 Electron 渲染断言。
- [F4.2：回合过程折叠](47-devlog-f4-2-process-fold.md)：过程与最终回答切分、折叠判据、回合起止时间、真实 IPC 桌面验收与三处实现坑。
- [F4.3：过程状态栏、顺序过程流与用时](50-devlog-f4-3-process-flow.md)：固定处理状态与实时/冻结用时、reasoning 摘要、Shell 过程标题、最终回答前折叠边界，以及后续由 F4.4 补齐的自动验收。
- [F4 实现汇总](52-devlog-f4-4-text-process.md)：合并文本过程、活动行、工具结果、图标流光与单 HTML 演示实现。
- [Host 工具列表排查](53-devlog-message-demo-tool-audit.md)：工具配置与模型白名单的只读诊断结论。
- [F4 验收与收尾](54-devlog-tool-result-rows.md)：自动验证与用户验收通过，阶段正式关闭。
- [F5.1 工作区布局与导航](57-devlog-f5-1-workspace.md)：侧栏双视图、顶部标签、状态保留与滑动过渡。
- [F5.2 真实项目入口](75-devlog-f5-2-project-entry.md)：合并整理前的 58 号接入核对；公共项目接口缺口与后端交接，项目创建 / 列表 / 详情的桌面桥接、失败码中文提示、目标可选、标签栏隐藏滚动条与两端淡出，以及 Electron 自动验收与用户人工验收。
- [F5.3–F5.8 Project 前端闭环规划](88-devlog-f5-project-plan.md)：当前运行期间的项目执行闭环与逐步接入边界。
- [F5.3 Project 工作区布局与交互设计](90-devlog-f5-3-workspace.md)：Roadmap 主画布与覆盖式 Main/Node 面板，原型用户验收、正式 Electron 布局接入及本地/代码 CI 已通过，PR #53 已 squash 合入 master（e271d5b）。

## 后端 Phase 12

- [F12.0 上下文压缩设计收口](109-devlog-f12-0-design.md)：上下文测量、压力触发、选区、摘要检查点、失败/取消/中断与 DeepSeek Harness 对照。
- [F12.1 Context Meter 与模型容量](110-devlog-f12-1-context-meter.md)：模型容量配置、Token 预算与请求前压力测量。
- [F12.2 上下文压力检测与执行接入](111-devlog-f12-2-pressure-integration.md)：在真实模型请求路径接入 Context Meter 并发布内部压力触发事件。
- [F12.3 摘要压缩与 Session 检查点](112-devlog-f12-3-compaction.md)：结构化累积摘要、安全前缀选区、检查点写入与请求重测量。
- [F12.4 超窗恢复与重启对账](113-devlog-f12-4-overflow-recovery.md)：provider 超窗归一、压缩后重试及未闭合事务恢复。
- [F12.5 主动压缩命令 /compact](114-devlog-f12-5-manual-compact.md)：复用现有命令与压缩核心，补齐当前 Session 上下文解析、独立事务身份、串行执行和重启恢复；本机完整验证通过，PR #77 已合入 master（3c464f5）。
- [F12.6 压缩与上下文压力公共契约](115-devlog-f12-6-public-context-contract.md)：三个版本化 Session API、上下文快照与订阅、有效历史分页及摘要检查点标识；生产实现与本机验证完成，Electron Bridge 实际调用通过；[PR #78](https://github.com/likeWind221/Navo/pull/78) head CI 通过并已合入 master（3bf5e10）。
- F12.7 长程压缩验收：验证多次压缩、超窗恢复与重启后的 AutoRun 闭环。
- [F12.4 超窗恢复与重启对账](113-devlog-f12-4-overflow-recovery.md)：统一识别 provider 超窗错误、强制压缩后单次重试，以及启动时未闭合压缩事务的中断对账。

## 工程治理与迁移

- [模块分文件架构审核](16-module-file-architecture-review.md)：历史快照，当时各包文件粒度、保留项与收敛建议。
- [开发文档整理](20-devlog-docs-reorganization.md)：命名规范化、碎片文档合并、编号重排、计划与索引重组；附整理前后编号与路径对照。
- [源码目录与命名整理方案](23-structure-plan.md)：后端、RPC、前端的模块目录、单词命名与逐文件映射；已实施。
- [源码目录与命名重构实施记录](24-devlog-structure.md)：77 条路径迁移、RPC 与共享契约拆分、用户偏好记忆和 278 项测试及 Electron 验收。
- [计划功能性描述重写与 F3.2 拆分](25-devlog-plan-functional-rewrite.md)：计划步骤改为功能性目标描述、CLAUDE.md 新增撰写原则、F3.2 拆为四个功能子步骤并确定 /hello 占位命令。
- [Navo 品牌迁移](49-devlog-navo-brand-migration.md)：SkillWorld → Navo 的 package、应用标识、环境变量、IPC、UI 与文档迁移边界。
- [CI 与 PR 流程接入](60-devlog-ci-pr-flow.md)：GitHub Actions 的 typecheck/test 门禁、Step 分支与 squash 合并约定，以及 CI 暴露的平台测试问题。

- [BUG-012：AutoRun 真实验收入口与输入](106-bugfix-bug-012-autorun-acceptance.md)：补齐真实入口、共享测试材料与逐回合证据，保留原失败现场。

- [BUG-013：AutoRun 桌面验收阻塞](107-bugfix-bug-013-autorun-desktop.md)：前端错误提示、测试发现规则与 Electron bridge 验收边界。
- [F11.3：桌面公共契约独立验收](108-devlog-f11-3-desktop-acceptance.md)：前端完整检查与真实 Electron bridge 的独立验收。

## 调研与归档

- [DeepSeek Harness 参考分析](01-harness-design.md)：单对话核心与最小 Agent 闭环设计。
- [Codex 提交审查归档](30-codex-reviews-archive.md)：原 `codex-reviews/` 目录的 10 份 post-commit 审查报告（阶段 2–7、F3、F4）合并归档；审查钩子已移除，不再生成新报告。
- [ChatGPT / Codex 式过程 UI 开源参考调研](43-devlog-chatgpt-codex-ui-research.md)：ai-elements、assistant-ui、lobehub、openai/codex 的思考/工具/过程折叠实现对比、许可证与可借鉴机制。
- [图标库选型调研](46-devlog-icon-library-research.md)：reicon 与 lucide 的许可、体量、绘图一致性实测对比，结论为本阶段继续使用自绘图标。
