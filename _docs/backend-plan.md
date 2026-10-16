# Navo 后端与 Agent Core 开发计划

> 当前产品定义以 `_docs/00-navo-prd.md` 为准。Phase 0–8 是已完成的通用执行基础；Phase 9 起，后端主线转向面向长期 Project 的 Roadmap、Main Agent 协调与隔离 Node Agent 执行；Phase 10 让 Project 可持久恢复并由 Main 判断节点完成。已完成阶段只保留功能目标与记录入口，实现细节以对应开发记录为准。

## 1. 当前范围

Phase 0–10 与模型接入补充工作 M1 均已完成。系统现在具备：

- 通用执行基础：Session / Event、LLM、ToolService、AgentRuntime、Search / Fetch、文件工具、Kernel Host 与桌面 Agent 链路（Phase 0–8）。
- 长期 Project 编排：Project、Roadmap、Main / Node Agent、Mailbox、Workspace 与 Resource，以及面向桌面的 `project.*.v1` 公共契约（Phase 9）。
- 持久恢复与完成判断：SQLite 持久保存与重启恢复、会话续接、中断收尾、Node 完成信号与 Main 复盘判定（Phase 10）。
- 模型接入：公共 Chat Completions / Responses 协议、ChatGPT 订阅授权与 OpenAI 接入（M1）。

当前主线是 Phase 11 全自动推进与上下文压缩，第一步 F11.0 设计收口尚未开始，见第 11 节。

```text
Project Goal
    |
    v
Roadmap (SQLite, recoverable)
    |
    +---------------------+
    |                     |
    v                     v
Main Agent            Project Nodes
(planning / review)   (isolated work units)
    |                     |
    +----------+----------+
               v
          AgentRuntime
               |
        LLM / ToolService
```

## 2. 核心产品契约（Phase 9 起持续有效）

### Project 是长期生命周期边界

Project 是长程目标的一级对象。Project 的 Goal、Roadmap、Main Agent 上下文、Node 集合、消息、Project Asset 和项目进度都应独立于单个 Turn 或单个 Session 长期存在。Session 负责 Agent 连续上下文，不承担 Project 全局事实的唯一存储职责。

### Roadmap 是用户与 Agent 共同看到的项目状态地图

Roadmap 是 Project 的权威进度模型，应支持长期展示为看板或“游戏地图”式进度视图。它描述 Node、节点关系、阶段状态、版本和变更历史，而不是 Main Agent 内部的一段临时计划文本。

Roadmap 以无环有向图表达路线，暂不实现循环。Core 需要表达必选节点、可选节点、并行汇合、节点跳过与动态插入等语义。当前是否可推进某 Node 是 Roadmap 状态的确定性结果，不单独把 Scheduler 提升为产品架构中心。

自 2026-10-15（BUG-010，设计见 [78](78-devlog-f10-0-design.md) D12）起，Roadmap 中每个 Node 都是带目标与完成标准的工作节点，不再有开始 / 结束 / 检查点等控制节点；Human 或 Main 确认后才解锁后继，原 required checkpoint 的人工关卡由此覆盖。旧数据库中的控制节点在打开时被忽略，其前后节点直接相连。Roadmap 修改工具拆为 `add_node`、`edit_node`、`remove_node`、`set_dependency`、`reorder_nodes`，每个工具只公布自己的参数。

### Node 状态约定

新建 locked，解锁后 idle，实际执行时 working，回合结束回到 idle；回合内调用 `submit_completion` 的，回合结束进入 submitted（待确认，不能启动、不解锁下游），Human 或 Main 可将其返工回 idle；人工可将 idle / submitted 确认为 completing，或将 locked / idle / submitted 确认为 skipped；两种终态均满足后续依赖。RoadmapStore 在同一批 Node 事件中追加 node-unlocked，手动 unlock 不能绕过必选祖先；没有路线的独立 Node 仍可使用 NodeStore 原有生命周期。

Main 不新增 locked / idle / working 等持久状态机：Project 创建时固定拥有 Main Session，ProjectRuntime 只维护“当前是否存在 active Main Turn”的瞬时运行时事实。

### Navo 只保留一个 AgentRuntime

Main Agent 与 Node Agent 不对应两套 Runtime，也不新增固定 Agent 类层级。两种角色都复用现有 `AgentRuntime`，通过不同的 Profile、可信 Binding 和 Session 获得不同职责与权限。

```text
Main Agent = AgentRuntime + Main Profile + Project Binding + Main Session
Node Agent = AgentRuntime + Node Profile + Node Binding + Node Session
```

Profile 决定模型看到的角色说明和工具集合；Binding 与领域授权负责实际资源边界。禁止仅依赖 Prompt 声明安全隔离。

### Main Agent 是唯一跨节点协调者

Main Agent 负责理解 Project Goal、规划与修改 Roadmap、协调 Node、复盘节点成果、处理阻塞和全局重规划。Node Agent 只负责自己的 Node，不读取其他 Node Agent 的 Session，不直接读取完整 Roadmap，也不能直接向其他 Node Agent 发消息。

跨节点协作统一经过 Main Agent：

```text
Node A ----X----> Node B

Node A ---> Project Mailbox ---> Main Agent ---> Project Mailbox ---> Node B
```

Node 的报告、阻塞、协调请求和 Project 级 Planning Request 应先成为 Project 可记录事实，再由 Main Agent 后续处理；不在一次工具调用中递归同步触发另一 Agent，以避免隐藏调用链和循环协调。

### Project Workspace 与 Resource Service 承载跨 Node 产物

每个 Project 直接绑定用户选择的真实 Workspace，Navo 自身的 Node 中间文件与正式 Resource 内容统一收口到 `.navo/`。正式 Resource 使用稳定 Resource ID，与文件名和目录扫描解耦；身份、来源、元数据、revision 和访问范围只能通过 Resource Service 改变。

```text
Project Workspace
  |
  +--> user files
  |
  +--> .navo/
         +--> nodes/
         +--> assets/<resource-id>/
                    +--> <entryRef>

Resource Service
  |
  +--> stable ResourceId
  +--> source Node
  +--> name / description / type
  +--> access: private | shared(nodeIds) | public
  +--> entryRef / revision
  |
  +--> SQLite metadata (F10.1c)
```

Main 负责把 Resource 从 private 定向共享给指定 Node，或提升为本 Project 内 public。Node 启动时只需要持续知道自己可见的 Resource metadata，正文按需读取；Resource 到位仍不会自动启动 Node。通用 Context Builder、动态 reload 与 RAG 尚未实现。

### Human 是 Project Agent Turn 的最终 Gate

Navo 不以“Project 事实一变化就自动唤醒 Agent”为目标。Project 创建、Roadmap 解锁、Mailbox 新消息、Resource 到位、Node 交作业或 Main / Node 的上一次 Turn 结束，都不得自动触发下一次 Main Agent 或 Node Agent Turn。所有 Agent Turn 都必须来自明确 Human Action；全自动推进只在 Phase 11 由用户显式切换后生效。

```text
Project facts changed
      |
      +--> Main can act ----X----> no auto-run
      |
      +--> Node ready ------X----> no auto-run
                                  |
                           Human explicit action
                             /             \
                            v               v
                      Main Agent Turn   Node Agent Turn
```

Main Session 在 Project 创建时已经拥有稳定身份，因此这里控制的是 **Main Turn 是否开始**，不是重新创建 Main Session。Node 报告 result 或交作业也不等于 Node 已完成，完成只能由 Human 确认或 Main 复盘判定。

### 长期有效的边界

- 不创建 `MainAgentRuntime`、`NodeAgentRuntime` 或按角色复制 Agent 执行引擎；
- 不让 AgentRuntime 感知 Project、Roadmap、Main/Node 角色或 Research 领域概念；
- 不把 Roadmap 仅保存在 Main Agent Session、Prompt 或一次 LLM 输出里；
- 不允许 Node Agent 直接读取、调用或向另一个 Node Agent 发消息；
- Node 默认不读取完整 Roadmap，也不拥有 Roadmap 修改工具；
- 不在消息工具调用中递归同步启动 Main 或另一个 Node；
- 不让 LLM 直接提交未经验证的 Roadmap 最终状态；
- RAG、向量检索、动态 Skill / Tool / Resource reload、Claim-Evidence Graph 与长期 Research Memory 留待后续阶段；
- 只借鉴显式 Message / Artifact 的 A2A 思想，不实现标准 A2A 的 Agent Card、网络发现或跨服务 Transport。

## 3. 开发方式

- 后端 Agent 只修改 `_docs/backend-plan.md`、`src/**`、`tests/**`、`scripts/**`、根 `package.json`、根 `pnpm-lock.yaml` 及明确分配给后端的开发记录；不修改 `frontend/**`。后端完成被前端依赖的交付后，按 AGENTS.md 同步 `frontend-plan.md` 的交接说明。
- 每个 Step 都从最新 `master` 创建独立分支；Agent 完成开发后创建指向 `master` 的 PR，不直接向 `master` 提交功能改动。
- PR 以 GitHub CI 作为合并 gate，固定执行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`；本机完整验证同样必需。
- CI 失败时由 Agent 在同一 PR 分支修复并触发 CI 重跑；本机与 CI 全部通过后直接 squash 合并到 `master`，不再设置单独的人工审查 gate。
- 只有当前 Step 的 PR 已通过 CI 并合入 `master` 后，才开始下一 Step。

```text
Agent 开发 -> 本机完整验证 -> 创建 PR -> GitHub CI (install / typecheck / test)
                                            |
                                            +-- FAIL --> Agent 修复 --> CI 重跑
                                            |
                                            +-- PASS --> squash merge --> master
```

- 计划只写功能目标与可验收结果；模块划分、协议字段、算法和文件级实现取舍写入对应开发记录。
- `AgentRuntime`、`ToolService`、`SessionStore` 继续保持通用命名，不为 Multi-Agent 新增重复 Runtime。
- 需要修改 Host、RPC、桌面共享契约或前端消费协议时，后端停止实现并先向用户报告，由前后端串行确认公共契约后再继续。
- `_docs/00-navo-prd.md`、`_docs/index.md` 与其他共享控制面按 AGENTS.md 由唯一写入者串行修改。

## 4. 状态说明

- ⬜ 未开始
- 🔄 进行中
- ✅ 已完成
- ⏸️ 延期
- ⛔ 阻塞

## 5. 已完成基础：Phase 0–8

下表只保留历史能力事实，不重新解释旧 SkillWorld 产品路线；详细实现和当时的阶段边界以对应开发记录为准，原始产品设计见 [48](48-legacy-skillworld-prd.md)。

| Phase | 状态 | 已形成的通用能力 | 当前用途 | 记录 |
|---|---|---|---|---|
| 0 | ✅ | TypeScript、Node、pnpm、Cordis 工程骨架 | Core 运行与模块装配基础 | [02](02-devlog-phase-0-scaffold.md) |
| 1 | ✅ | 品牌化 ID、LLM / Tool 公共协议 | Project / Roadmap 新身份继续沿用同一协议风格 | [03](03-devlog-phase-1-core-protocol.md) |
| 2 | ✅ | SessionEvent、追加日志、消息投影与 Surface | Main / Node Session 的执行记录基础 | [04](04-devlog-phase-2-session-log.md) |
| 3 | ✅ | 流式 LLM、ToolService、Schema、错误与取消边界 | 所有 Agent Profile 共用模型和工具执行面 | [05](05-devlog-phase-3-llm-tools.md) |
| 4 | ✅ | 通用 `AgentRuntime`、Turn 生命周期、重试、取消、同 Session 串行 | 唯一 Agent 执行内核 | [06](06-devlog-phase-4-agent-runtime.md) |
| 5 | ✅ | 应用组合与模型 -> 工具 -> 模型闭环 | Project 级能力向下复用的稳定执行链 | [07](07-devlog-phase-5-app-composition.md)、[08](08-devlog-phase-5-loop-integration.md)、[09](09-devlog-version-closure.md) |
| 6 | ✅ | NodeEvent / NodeStore、Node–Session 绑定、NodeAgent Profile、跨 Node 隔离 | Generic Node 的主要迁移基础 | [10](10-devlog-phase-6-node-learning.md) |
| 7 | ✅ | `web_fetch`、公共网络策略、HTML -> Markdown | Node 工作中的网页调研能力 | [18](18-devlog-phase-7-fetch.md) |
| 8 | ✅ | `read`、`shell`、`edit`、`write`、Fetch spill、文件版本与并发保护 | Node 工作区执行能力 | [21](21-devlog-phase-8-file-tools-plan.md) |

桌面侧的 Kernel Host、真实模型 Adapter、回合与工具事件、会话命令和 RPC 链路见 [17](17-devlog-step-f2-2-kernel-host.md) 及前端计划 F2–F3 的后端交接记录；既有能力维护见 [19](19-devlog-tool-availability.md)。

## 6. Phase 9（F9）：Project-Oriented Multi-Agent Roadmap Runtime ✅

**阶段目标：** 让 Navo 能把一个长期 Goal 作为 Project 持续管理：Main Agent 维护可视化 Roadmap，多个隔离 Node Agent 分别推进节点；每个 Project 拥有独立 Workspace，Node 的报告、阻塞和 Resource 回到 Project / Main 协调；Main 可以安全修改 Roadmap 并为后续 Node 准备可发现资源，但 Main / Node 的每一次真实 Agent Turn 都只能由 Human 明确触发。2026-10-08 全部完成；架构收口见 [51](51-devlog-phase-9-project-runtime-design.md)。

| 状态 | Step | 功能目标 | 记录 |
|---|---|---|---|
| ✅ | F9.0 Project Runtime 架构与边界收口 | 明确 Project、Roadmap、Main Agent、Node Agent、单一 AgentRuntime 和通信边界，不再以 Scheduler / Coordinator 为中心 | [51](51-devlog-phase-9-project-runtime-design.md) |
| ✅ | F9.1–F9.2 Project 与通用 Node 领域 | 独立于单次会话的长期 Project 身份、Goal、主会话与生命周期；通用工作节点、独立会话、串行与并行执行，最终完成或跳过由人确认 | [55](55-devlog-project-node-domain.md) |
| ✅ | F9.3 In-Memory Roadmap（F9.3.1–F9.3.3） | 可修改的路线图：节点关系、必选 / 可选、分叉汇合、原子变更、版本与历史重建、依赖解锁和地图查询（控制节点能力已于 2026-10-15 撤销） | [56](56-devlog-persistence-plan.md)、[58](58-devlog-f9.3-roadmap.md) |
| ✅ | F9.4 Agent Profile 与 Binding | Main 与 Node 在同一 AgentRuntime 上获得不同角色与能力，由可信 Binding 约束实际可访问资源 | [59](59-devlog-f9.4-agent-profile-binding.md) |
| ✅ | F9.5 Main Agent Planning 与 Roadmap Mutation | Main 基于 Goal 读取、创建和修改 Roadmap，陈旧版本、非法关系和跨 Project 访问被拒绝 | [61](61-devlog-f9.5-main-agent-planning.md) |
| ✅ | F9.6 Project Workspace 与 Resource Handoff（F9.6a–F9.6f） | Mailbox、真实 Workspace 与 `.navo/`、Resource 生命周期与访问权限、Main 定向交接、Node 资源上下文与 Human Gate 端到端验收 | [62](62-devlog-f9.6-workspace-resource-handoff.md)、[70](70-devlog-resource-access-rename.md) |
| ✅ | F9.7 Human-Controlled ProjectRuntime（F9.7a–F9.7c） | Human 控制 Main / Node Turn 的统一入口：显式启动、后续回合、定向取消、人工完成 / 跳过，以及失败、取消、归档与释放后的收口 | [63](63-devlog-f9.7a-project-runtime-core.md)、[64](64-devlog-f9.7b-human-control.md)、[65](65-devlog-f9.7c-runtime-recovery.md) |
| ✅ | F9.8 长程 Core 集成验收 | 完整 Human-in-the-loop 长程场景证明 Project、Roadmap、Main、多个 Node、资产交接与路线调整共同工作；真实验收经 BUG-001 至 BUG-004 修复后收口 | [66](66-devlog-f9.8-longterm-acceptance.md)、[68](68-bugfix-bug-001-004-longterm.md) |
| ✅ | F9.9 Public Project / Roadmap Contract（F9.9a–F9.9c） | 桌面可创建、列出和查看项目，启动、继续、取消 Main / Node 回合并确认节点，打开项目后实时跟随变化；交付 `project.*.v1`（PR #35–#37） | [71](71-devlog-f9.9a-project-query.md)、[72](72-devlog-f9.9b-human-control.md)、[73](73-devlog-f9.9c-project-follow.md) |
| ✅ | F9.10 项目目标确认与规划前置 | 创建项目可不填目标；Main 复述目标并获用户同意后才写入目标并生成初始 Roadmap；Roadmap 生成后目标锁定（PR #38） | [74](74-devlog-f9.10-goal-confirm.md) |

## 7. Phase 10（F10）：可恢复、由 Main 判断完成的长期 Project ✅

**阶段目标：** 让 Project 在应用退出并重新启动后仍能继续推进，并形成 PRD 中“执行 -> 验证 -> 再规划”的闭环：Node 认为任务完成时发出完成信号，节点进入待确认；Human 可以直接确认完成、发返工意见或跳过，也可以请 Main 复盘；Main 复盘时根据节点成果判定完成、返工或跳过，并按成果调整后续计划。执行者不能自行宣布完成。Human Gate 不变。2026-10-15 全部完成；设计与历次修订见 [78](78-devlog-f10-0-design.md)（D1–D12，2026-10-15 撤销独立验证者，改由 Main 判断完成）。

```text
Human start Node ---> Node works / publishes Resource
                              |
                Node sends done signal -> Node is awaiting confirmation
                              |
        +---------------------+----------------------+
        | Human decides directly                     | Human asks Main to review
        v                                            v
  complete / rework feedback / skip     Main reads turn report, goal, criteria,
                                        Resources, Mailbox; gives one decision:
                                        complete / rework feedback / skip / ask Human
                                        and may modify downstream Roadmap
        |                                            |
        +---------------------+----------------------+
                              v
  complete -> downstream Nodes unlock;  rework -> Human starts Node again,
  Node sees the feedback in its next Turn
[ all facts above survive restart; interrupted Turns are never resumed automatically ]
```

| 状态 | Step | 功能目标 | 验收与记录 |
|---|---|---|---|
| ✅ | F10.0 持久化与验证设计收口 | 确定持久保存范围、写入成功的含义、重启恢复与中断处理规则，以及完成判断的归属 | 只用 SQLite 并存于 `~/.navo/`；单个 Project 损坏只隔离；2026-10-10 经用户确认，见 [78](78-devlog-f10-0-design.md) |
| ✅ | F10.1a 项目与工作目录持久保存 | Project、目标、归档状态和 Workspace 绑定在重启后仍然存在 | 真实 Host 重启验收，见 [79](79-devlog-f10-1a-project-persist.md) |
| ✅ | F10.1b 节点与 Roadmap 持久保存 | Roadmap、变更历史及 Node 状态与解锁结果在重启后保持一致 | 同一事务提交，见 [81](81-devlog-f10-1b-roadmap-persist.md) |
| ✅ | F10.1c 消息与资源登记持久保存 | Project 消息与资源登记（含访问范围与版本）在重启后仍然存在 | 实体写好后才登记，见 [82](82-devlog-f10-1c-mailbox-resource-persist.md) |
| ✅ | F10.1d 损坏隔离与整体重启验收 | 单个 Project 损坏只影响该 Project，五类数据共同经历真实重启 | 见 [87](87-devlog-f10-1d-recovery-isolation.md) |
| ✅ | F10.2 会话与执行记录恢复 | Main / Node 会话、工具调用与结果在重启后续接原上下文，不重新执行工具 | PR #55，见 [93](93-devlog-f10-2-session.md) |
| ✅ | F10.2a 普通会话保存与重启续接 | 不属于 Project 的普通会话按原 Session ID 续接；普通会话损坏只隔离该会话 | PR #56，见 [93](93-devlog-f10-2-session.md) 第二、三节 |
| ✅ | F10.3 中断处理 | 退出时进行中的普通 / Main / Node Turn 在重启后处于明确的已中断状态，由用户决定是否继续 | 真实 Host 终止 / 重启验收，PR #58，见 [94](94-devlog-f10-3-interruption.md) |
| ✅ | F10.4a 完成信号与待确认 | Node 用 `submit_completion` 交作业后进入 submitted；Human 确认、返工或跳过，返工意见在 Node 下一回合开始时送达 | PR #59，见 [96](96-devlog-f10-4a-done-signal.md) |
| ✅ | F10.4b Main 复盘判定与计划调整 | Human 请 Main 复盘节点，Main 用 `submit_review` 给出完成 / 返工 / 跳过 / 交给 Human 中的唯一判定，并可调整下游计划；返工上限 2 次 | PR #60；**经用户决定免除真实模型五场景验收**，仅 Qwen 跑通“成果达标则完成”场景，见 [97](97-devlog-f10-4b-main-review.md) |
| ✅ | F10.5 F10 长程集成验收 | 交作业、Main 返工、按意见补做、Main 判完成并调整计划、两次重启恢复的完整长程场景 | 离线完整场景通过；`gpt-6-sol` 真实验收在 BUG-010 修复后通过前 6 个回合，**经用户决定免除第 7–11 回合**（相应能力仅离线验证）；过程中发现并修复 BUG-011，见 [98](98-devlog-f10-5-rework-loop.md)、[99](99-bugfix-bug-011-restart-order.md) |

## 8. 模型接入补充工作（M1）✅

用户选择新 ChatGPT 订阅接入，并要求公共模型协议可供后续厂商复用。M1 不占用 F10 编号；调研与方案见 [83](83-devlog-chatgpt-provider-research.md)、[84](84-devlog-model-protocol-design.md)。已交付步骤未修改前端或公开 RPC 契约，前端登录与模型选择另行规划。

| 状态 | Step | 功能目标 | 验收与记录 |
|---|---|---|---|
| ✅ | M1.1 现有模型接入可复用的协议基础 | Qwen 继续正常工作，后续 Chat Completions 接入可直接复用消息、工具和流解析能力 | PR #49，见 [85](85-devlog-m1-1-protocols.md) |
| ✅ | M1.2 新协议下的连续对话与工具往返 | 系统能正确理解 Responses 输出，并在下一次请求中带回足够的历史与工具结果 | PR #51，见 [86](86-devlog-m1-2-responses.md) |
| ✅ | M1.3 本机订阅授权与账号模型查询 | 用户可独立登录 ChatGPT、查看自己的模型、刷新凭据及登出 | PR #52，见 [89](89-devlog-m1-3-chatgpt-auth.md) |
| ✅ | M1.4 Navo 使用订阅模型完成工作 | 用户可通过配置选择订阅模型完成对话和现有工具闭环 | PR #54，见 [91](91-devlog-m1-4-openai.md)；BUG-009 见 [92](92-bugfix-bug-009-namespace.md) |

## 9. Phase 11（F11）：全自动推进与上下文压缩

**阶段目标：** 让 Project 可以在人工推进与全自动推进两种模式间选择，模式只由用户切换。两种模式共用 F10.4 的完成信号、复盘判定与计划反馈；全自动模式由一个独立驱动层负责在安全决策点自动发起已有 Main / Node Turn，并在停止条件、高风险动作或无法判断时退回 Human。长时间运行的 Session 通过上下文压缩持续工作。人工模式的 Human Gate 保持不变。

**F11.0 收口结果：** 设计记录见 [100](100-devlog-f11-0-design.md)。已明确 manual / auto 与 running / paused 两层状态、Main / Node 调度顺序、64 / 32 的连续 Auto Run 回合预算、失败 / 取消 / 中断语义、高风险操作的 fail-closed 边界，以及 80% 压缩阈值、16% recent tail 与 overflow recovery。当前仅完成设计文档，生产代码仍保持 F10 的 Human Gate 行为。

```text
Human switch / resume
        |
        v
  +--> Auto Driver decision point
  |          |
  |          +--> Human Main input --------> Main Turn
  |          +--> pending Node review -----> Main Review
  |          +--> eligible Nodes ----------> Node Turn(s)
  |          +--> no runnable Node ---------> Main Planning
  |          +--> no safe decision --------> Auto paused
  |
  +-- Node normal stop --------------------> Main Review
  +-- Node failed/cancelled/interrupted ---> Auto paused (no review)
  +-- Main ask_human / limit / high-risk -> Auto paused
  +-- restart of auto Project -------------> Auto paused
```

| 状态 | Step | 职责范围 | 工作内容（功能目标） | 完成标准 |
|---|---|---|---|---|
| 🔄 | F11.0 全自动推进设计收口 | 后端设计记录 | 在 [78](78-devlog-f10-0-design.md) D11 已确认的模式切换、推进规则、复盘钩子、暂停条件与重启规则基础上，收口两层状态、自动调度顺序、Main / Node 连续 Auto Run 预算、高风险操作边界及上下文压缩契约 | [100](100-devlog-f11-0-design.md) 已落地；设计记录明确采用 / 不采用的 Harness 机制与 F11 验收项；待用户确认后进入 F11.1 |
| ⬜ | F11.1 会话上下文压缩 | 通用 Session / Main / Node 会话 | 让长时间运行的普通、Main 与 Node 会话在上下文接近模型上限时自动压缩，压缩后仍能接着原任务工作 | 压缩后关键目标、决定与未完成事项仍在上下文中；完整执行记录仍保留可追溯；压缩结果随会话保存与恢复；压缩失败不破坏原会话 |
| ⬜ | F11.2 推进模式与驱动循环 | Project 执行控制面 | 让用户为 Project 选择人工或全自动推进；全自动模式下依赖已满足的空闲节点自动启动，Node 回合结束后系统触发 Main 复盘，并按复盘结果继续推进 | 依 [100](100-devlog-f11-0-design.md) 的状态机、优先级、64 / 32 Auto Run 预算与并发边界实施；人工模式行为与 F10 一致 |
| ⬜ | F11.3 停止条件与暂停求助 | Project 执行控制面 / Main 协调 | 让全自动推进在返工过多、超出回合上限、回合失败或 Main 需要用户决定时停下来，并让用户看到停止原因后决定继续或切回人工 | 失败 / 取消 / 中断不隐式重试；单节点返工意见超过 2 次、Main / Node Auto Run 预算耗尽、复盘无判定、高风险或需要 Human 决策时暂停；暂停期间不启动新回合 |
| ⬜ | F11.4 全自动推进公共契约 | Host / RPC 共享契约 | 让桌面能切换推进模式、暂停与恢复自动推进，并看到当前是否在自动运行、停在哪里以及原因 | 开始前停止修改并按共享契约流程与前端确认；方法带版本、两端严格校验；跟随项目时能实时看到模式与停止原因的变化 |
| ⬜ | F11.5 F11 长程集成验收 | 后端集成测试与阶段记录 | 用一个包含多个节点、返工、暂停求助、重启和最终完成的全自动长程场景证明 F11 能力共同工作 | 离线完整场景可重复通过；真实模型全自动运行保留完整记录，失败现场可用于定位 |

## 10. 后续阶段

| Phase | 核心问题 | 目标产物 |
|---|---|---|
| Phase 12 | Research Workspace 如何使用通用 Core？ | Research Agent Profile、Claim / Evidence、RAG 与研究领域适配 |
| Phase 13 | 系统如何与研究者长期共同演进？ | Research Memory、长期反馈与 Human-AI Co-evolution |

Coding 与 Learning 作为后续 Mode Adapter 验证 Core 通用性，不恢复为独立产品主线。

## 11. 当前下一步

**Phase 10（F10.0–F10.5）与 M1 已全部完成（2026-10-15）。下一后端步骤为 F11.0 全自动推进设计收口，尚未开始，需用户确认后进入。**

- 免除记录：F10.4b 真实模型五场景验收与 F10.5 第 7–11 回合真实验收均经用户决定免除，相应能力只由离线测试覆盖，见第 7 节。
- 未关闭 Bug（以 [Bug 跟踪表](bug-plan.md) 为准）：BUG-002 保持未关闭、等待复现；BUG-007 经用户决定搁置；BUG-010 修复已合入，Qwen 与 Electron 复验待本机完成。
- 前端依赖：F10.4a / F10.4b 的公共契约变化与控制节点移除已同步到 [前端计划](frontend-plan.md) F5 交接说明，前端展示由 F5.4–F5.8 接入。
