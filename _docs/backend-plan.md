# Navo 后端与 Agent Core 开发计划

> 当前产品定义以 `_docs/00-navo-prd.md` 为准。Phase 0–8 是已完成的通用执行基础；Phase 9 起，后端主线转向面向长期 Project 的 Roadmap、Main Agent 协调与隔离 Node Agent 执行；Phase 10 让 Project 可持久恢复并由 Main 判断节点完成。已完成阶段只保留功能目标与记录入口，实现细节以对应开发记录为准。

## 1. 当前范围

Phase 0–10 与模型接入补充工作 M1 均已完成。系统现在具备：

- 通用执行基础：Session / Event、LLM、ToolService、AgentRuntime、Search / Fetch、文件工具、Kernel Host 与桌面 Agent 链路（Phase 0–8）。
- 长期 Project 编排：Project、Roadmap、Main / Node Agent、Mailbox、Workspace 与 Resource，以及面向桌面的 `project.*.v1` 公共契约（Phase 9）。
- 持久恢复与完成判断：SQLite 持久保存与重启恢复、会话续接、中断收尾、Node 完成信号与 Main 复盘判定（Phase 10）。
- 模型接入：公共 Chat Completions / Responses 协议、ChatGPT 订阅授权与 OpenAI 接入（M1）。

Phase 11 自动化流程已收口：F11.0–F11.4 完成，F11.3 已补齐前端独立检查与 Electron bridge 实际调用验收，见 [108](108-devlog-f11-3-desktop-acceptance.md)。正式页面 AutoRun 控件未包含在本次公共契约验收。Phase 12 上下文压缩已完成 F12.0 设计收口与 F12.1 Context Meter（[109](109-devlog-f12-0-design.md)、[110](110-devlog-f12-1-context-meter.md)）。经用户确认，后续拆为 F12.2 压力检测接入、F12.3 摘要与检查点、F12.4 超窗恢复、F12.5 主动 `/compact` 命令；F12.5 已通过 PR #77 合入 master（提交 3c464f5），本机 pnpm typecheck 与 748 项测试通过，桌面点击级验收仍未执行。F12.6 压缩与上下文压力公共契约已完成生产实现，本机后端 771 项、前端 153 项测试与 Electron Bridge 实际调用验收通过，PR #78 head CI 通过并已合入 master（3bf5e10）；F12.2 / F12.3 的本机完整验证已于 2026-10-18 补齐（122 文件、771 项通过），F12.0–F12.6 全部完成，见 [116](116-devlog-f12-verification.md)；F12.7 已完成本机 793 项与真实 28 请求 / 3 次压缩 / 重启 / 两 Node 审查验收，PR #79 当前 head CI 通过并合入 master，见 [117](117-devlog-f12-7-acceptance.md)；RAG 留待 Phase 13。

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

Main 负责把 Resource 从 private 定向共享给指定 Node，或提升为本 Project 内 public。F13.4a 已提供统一 Turn Context，每次模型请求前获取权威任务状态与必要提醒。F13.4c 通过 list_resources 浏览权限内目录、search_resources 混合检索和 fetch_resource 分页阅读原文，已知信息或有效 ID 可直接使用，不强制调用顺序；完整目录不再注入上下文或工具 Schema。Node 仅保留新增可见资料的 ID / 名称提醒，Resource 到位不会自动启动 Node。Roadmap 负责规划，Project / Node Store 负责权威状态，Resource Store 负责资料与权限，不单独实施 F13.4b Working Board。架构与工具说明见 [153](153-devlog-f13-4c-resource-discovery.md)。

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

## 9. Phase 11（F11）：自动化流程

**阶段目标：** 让 Project 从 F10 的 Human Gate 驱动，升级为可由 Human 显式开启、可暂停、可接管的全自动推进流程。Main / Node 的领域职责与 F10.4 的完成信号、复盘判定和计划反馈保持不变；Phase 11 只增加“由谁在什么条件下发起下一次 Agent Turn”的自动驱动层。上下文压缩归入 Phase 12，RAG 归入 Phase 13。

~~~text
Human switch / resume
        |
        v
  +--> Auto Driver decision point
  |          |
  |          +--> Human Main input --------> Main Turn
  |          +--> pending Node review -----> Main Review
  |          +--> eligible Node ----------> Node Turn(s)
  |          +--> no runnable Node ---------> Main Planning
  |          +--> no safe decision --------> Auto paused
  |
  +-- Node normal stop --------------------> Main Review
  +-- Node failed/cancelled/interrupted ---> Auto paused
  +-- Main ask_human / limit / high-risk -> Auto paused
  +-- restart of auto Project -------------> Auto paused
~~~

| 状态 | Step | 职责范围 | 工作内容（功能目标） | 完成标准 |
|---|---|---|---|---|
| ✅ | F11.0 自动化流程与自主运行架构设计收口 | 后端设计记录 | 收口 manual / auto 与 running / paused 两层状态、Main / Node 自动调度顺序、连续 Auto Run 回合预算、失败 / 取消 / 中断、高风险操作与 Human 接管边界 | [100](100-devlog-f11-0-design.md) 已落地；明确 F11 的状态机、调度、预算、停止与验收规则；不修改生产代码；设计已收口 |
| ✅ | F11.1 自动推进驱动最小闭环 | Project 执行控制面 | 在用户开启 Auto 后，自动选择 eligible Node，Node 正常收口后触发 Main Review；Main 可基于复盘结果修改 Roadmap，AutoRun 每轮重新读取最新计划并按 complete / rework / skip 继续推进 | 人工模式行为与 F10 一致；全自动模式可完成一个多 Node 离线闭环，并覆盖 Main 复盘中的动态重规划；同一 Node 不并发，Main 同时最多一个 Turn |
| ✅ | F11.2 暂停、恢复与失败处理 | Project 执行控制面 | 实现 turn limit、pause / resume、failed / cancelled / interrupted、ask_human 以及 Human 随时接管 | 达到任一 Auto Run 预算或停止条件后自动暂停并记录原因；失败不无限重试；重启后的 Auto Project 不自动运行 |
| ✅ | F11.3 全自动推进公共契约 | Host / RPC 共享契约 | 让桌面调用方能切换人工 / 全自动模式、暂停与恢复，并读取当前运行状态、停在哪里及原因 | project.autorun.*.v1 已接入 Host / RPC / Electron；前端 139 测试、typecheck/build 与 Electron bridge 实际调用通过；代码 head CI 通过，收口提交按当前 head CI 门禁合并；正式页面控件另行交付，见 [108](108-devlog-f11-3-desktop-acceptance.md) |
| ✅ | F11.4 F11 长程自动化验收 | 后端集成测试与阶段记录 | 用多 Node、返工、暂停求助、失败、重启和最终完成场景证明自动推进共同工作 | 本机 695 项完整测试、gpt-6-sol 双节点自动完成与代码 head CI 通过；离线覆盖暂停/失败/重启/返工/skip，真实证据与失败现场见 [105](105-devlog-f11-4-autorun-acceptance.md) |

## 10. Phase 12（F12）：长程上下文压缩

**阶段目标：** 让长期运行的 Main / Node Session 在接近模型上下文上限时仍能继续工作：系统在每次请求前知道当前上下文压力，越线时把最早的历史替换为摘要检查点并保留近期原文；Human 可通过 `/compact` 提前压缩；模型确认超窗时压缩后重试；重启后从已落盘的检查点续接。压缩是 Session 级通用能力，不感知 Project / Roadmap；Project 权威状态继续由每回合重建的系统提示提供。跨 Session 检索与可召回压缩归入 Phase 13。

~~~text
                         Human /compact
                               |
                               v
                         trigger=manual
                               |
Step start -> Context Meter -> trigger=pressure
                               |
Provider context overflow ----+--> shared Compaction core
                                    |
                                    v
                         started -> summary -> checkpoint -> ended
                                    |
                         +----------+-----------+
                         |                      |
                    no progress              success
                         |                      |
                   no history change       next request uses
                                           checkpoint surface

Host restart -> unmatched compaction marked interrupted -> replay committed checkpoint
~~~

| 状态 | Step | 职责范围 | 工作内容（功能目标） | 完成标准 |
|---|---|---|---|---|
| ✅ | F12.0 上下文压缩设计收口 | 后端设计记录 | 收口上下文测量、压缩触发、选区与工具配对、摘要检查点、事务事件、失败 / 取消 / 中断及与 AutoRun 的衔接，并拆分后续子 Step | [109](109-devlog-f12-0-design.md) 已落地；附 DeepSeek Harness 对照与不采用项；不修改生产代码 |
| ✅ | F12.1 Context Meter 与模型容量 | Agent 请求前检查与模型配置 | 每个模型声明上下文容量与可选压缩上限；每次请求前能算出 Session 当前上下文压力并判断是否越过压缩阈值；容量缺失或配置矛盾时明确禁用自动压缩 | 离线测试覆盖 usage 锚点、估算、阈值与保留预算计算和配置校验；现有回合行为不变；见 [110](110-devlog-f12-1-context-meter.md) |
| ✅ | F12.2 上下文压力检测与执行接入 | Agent 请求构建与执行入口 | 在模型请求前接入 Context Meter，依据预算判定当前压力，并为压缩动作提供明确触发点；阈值以下保持现有行为 | 压力测量、阈值边界、容量缺失与预算禁用均有执行链路测试；未越线时请求和历史行为不变；越线时发布内部触发事件；见 [111](111-devlog-f12-2-pressure-integration.md) |
| ✅ | F12.3 摘要压缩与 Session 检查点 | 上下文压缩与 Session 日志 | 越过阈值后选择可压缩历史并生成摘要检查点，保留近期尾部且不拆开工具调用与结果；压缩失败保留历史，只有重新测量仍在可接受预算内才继续请求 | 离线多回合 Session 触发压缩后继续完成任务；日志可回放出相同 surface；失败、不收缩、无有效选区及历史配对均有测试 |
| ✅ | F12.4 超窗恢复与重启对账 | 模型错误归一、Agent 执行与重启恢复 | 模型确认超窗后压缩一次再重试；压不动时回合以明确原因失败并让 AutoRun 暂停；重启后未完成的压缩记为中断，从已落盘内容续接 | 本机 typecheck 与完整测试、当前 PR head CI 均通过；见 [113](113-devlog-f12-4-overflow-recovery.md) 与 [PR #76](https://github.com/likeWind221/Navo/pull/76) |
| ✅ | F12.5 主动压缩命令 /compact | CommandService、Session 压缩与恢复 | Human 可在未达到压力阈值时主动压缩；复用现有 selector / summarizer / checkpoint，使用当前 Session 上下文，串行执行且支持独立事务恢复 | session.command.v1 可调用；Main / Node / 普通 Session 上下文解析正确；无虚构 Turn；no-op / failure / cancel / restart 均有测试；本机 typecheck 与 748 项完整测试通过，PR #77 当前 head CI 通过并已合入 master（3c464f5）；Host 命令入口成功 / no-op 已验证，未做 Electron 点击级验收；见 [114](114-devlog-f12-5-manual-compact.md) |
| ✅ | F12.6 压缩与上下文压力公共契约 | Host / RPC / Electron 共享契约 | 让桌面调用方查询 Session 当前上下文用量、订阅上下文与压缩状态，并分页读取有效历史且识别摘要检查点 | 三个版本化接口有严格运行时校验和明确错误 / 取消语义；快照与现有请求测量一致；实时订阅无遗漏、重复或乱序且可取消；历史分页在压缩后检测 generation 变化；Electron Bridge 实际调用通过；仅提供 API，不开发 UI。本机 771 项后端测试、153 项前端测试、typecheck / build 与 Electron Bridge 验收通过；[PR #78](https://github.com/likeWind221/Navo/pull/78) head CI 通过并已 squash 合入 master（3bf5e10）；见 [115](115-devlog-f12-6-public-context-contract.md) |
| ✅ | F12.7 长程压缩验收 | 后端集成测试与阶段记录 | 证明 AutoRun 驱动的 Project 能跨越多次压缩、超窗恢复和重启后完成 | 本机 130 文件 / 793 项与类型检查、代码 CI 通过；gpt-6-luna 真实 28 请求（3 摘要）、三次压力压缩、暂停 / JSON 交接 / 同库重启（14→14）、两 Node 零返工获 Main complete；超窗恢复仅离线验证，见 [117](117-devlog-f12-7-acceptance.md) |

## 11. Phase 13（F13）：项目资料库与任务检索

**阶段目标：** 将项目内 Resource 的集合升级为项目资料库，统一组织用户参考资料与 Agent 成果，让用户及 Main / Node 在权限范围内找到相关内容、按需阅读原文，并用可核验的依据完成长程任务。2026-10-18 用户已确认阶段方向与七步规划；阶段规划见 [124](124-devlog-f13-plan.md)；F13.0 已于 2026-10-19 经用户确认完成，见 [125](125-devlog-f13-0-design.md)。F13.1a 的共享资产生命周期内核与真实进程中断验收已完成，PR #80 已合并；BUG-023 的操作重试语义修复随 PR #81 合并且 CI 通过；PR #82 文档收尾已合入 master。F13.1b 已按冻结设计 [134](134-devlog-f13-1b-design.md) 实现并随 PR #87 合并至 master（提交 `845b864`），当前 head CI 成功，本机 typecheck 与 891 项完整测试通过，实施记录见 [135](135-devlog-f13-1b-content.md)。F13.1c 已按技术设计 [136](136-devlog-f13-1c-design.md) 实施，本机 Node 24 类型检查与 897 项完整测试通过；PR #88 代码 head `1ef0907` 的 CI run `39565765501` 成功，见 [137](137-devlog-f13-1c-user-intake.md)。F13.2a 后端实现与 PR #89 CI 已完成并合入 master，见 [139](139-devlog-f13-2a-library-organization.md)；F13.2b 资料管理公共 RPC、Electron Bridge 与实际调用验收已完成，见 [140](140-devlog-f13-2b-desktop-resource-management.md)，正式 Renderer 页面仍待前端实施。2026-10-22 已确认不新增 F13.2c；F13.2 父项继续因正式 Renderer 页面与交互验收未完成而保持进行中，但不阻塞后端主线。F13.3a GraphRAG 核心设计已确认，见 [142](142-devlog-f13-3a-graphrag-design.md)；F13.3b 已按冻结设计 [143](143-devlog-f13-3b-chunk-embedding-design.md) 实现 SQLite-only Chunk / Embedding 索引、可恢复原子构建与内部语义召回，本机验证通过，实施见 [144](144-devlog-f13-3b-chunk-embedding.md)；PR #91 已合入 master，后续已于 2026-10-25 完成真实 Embedding 小规模 smoke test，见 [151](151-bugfix-bug-030-embedding-deployment.md)；F13.3c 本机验证与 PR #92 CI 通过并已合入，见 [146](146-devlog-f13-3c-graph.md)。

### 首版范围与边界

- 资料身份、项目归属与访问范围沿用 Resource；资料库不产生另一套冲突的资料身份或权限。项目内 public 不等于跨项目公开，Main / Node 的访问边界继续生效。
- 用户参考资料与 Agent 成果均可进入资料库，但来源必须可辨识；成为 Resource 或被引用不代表内容已经核实。现有 revision 不视为已具备正文多版本管理。
- 首版正文检索支持 Markdown、TXT 与可提取文本的 PDF，不承诺复杂表格、公式、图片或扫描件理解。所有文件均可保存；状态区分处理中、正文可检索、仅文件信息可搜索、处理失败，失败保留文件并可重新处理。
- 采用文件夹与子文件夹组织，按格式、路径与状态查找，不使用标签；描述用户选填，不自动生成。支持整目录导入，Agent 发布默认根目录，标注创建者。不自动将每次回答纳入资料库。
- F13 不替代 F12 压缩；跨项目知识库、Session / 被压缩历史召回、任意 Workspace 全量检索、外部知识库同步和团队协作留待后续。用户于 2026-10-22 确认 F13 采用 GraphRAG；首期包括图谱构建、关系 / 多跳检索，社区摘要与全局检索作为后续扩展。
- 不提前锁定检索算法、Embedding、重排模型、向量库或服务商。真实模型验收另报耗时、额度与影响范围，取得授权后执行。
- 用户已决定首版不增加独立证据评估环节、不接入 Jev 类决策模型；由 Main / Node 继续负责按需搜索、阅读与补查，相关调研留存于 125，不作为本阶段实施依赖。
- 用户可管理项目全部资料，用户导入默认项目内全部 Node 可用；Node / Main 沿用既有 Resource 工具能力与权限，不新增 Agent 文件夹管理、目录导入、内容替换或移动能力。首版不做权限编辑、正文历史版本恢复或独立停用功能。

### 步骤与完成标准

下表保留完整产品目标与后端交付边界。桌面页面、交互与 Electron 正式 UI 验收交由 [前端计划](frontend-plan.md) 承接；后端通过不自动表示产品步骤整体完成。

| 状态 | 步骤 | 职责范围 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | F13.0 产品设计收口 | 产品规则、前后端交接与验收设计 | 明确资料范围、页面流程、用户导入归属、生命周期、访问权限与首版格式，让后续每步有可审查边界 | 产品流程、资料变化与引用规则、前后端职责、验收样例已确认；明确与 F5 的依赖，拆分需要稳定交换数据的公共契约交付；不修改生产代码 |
| 🔄 | F13.1 资料进入与可用状态 | 项目资料接收、处理与恢复 | 用户能添加参考资料，Agent 产物可进入资料库，并知道哪些内容已可使用 | 支持多文件、拖拽与目录导入并保存副本；保存与正文可用状态可区分；正文处理失败可显式重处理；保存失败可重新提交，取消保留已提交项，重启续接正文处理；替换与删除符合 F13.0 规则。F13.1a、F13.1b 与 F13.1c 后端能力已验证；桌面入口和 UI 仍待前端交接，因此父项保持进行中 |
| ✅ | F13.1a 共享资产生命周期内核 | 原始文件、身份与生命周期 | Agent 资料能可靠保存，替换、删除和重启不破坏有效资料 | 单文件暂存、不可变版本、Resource 事件与操作记录同事务提交；路径唯一、失败恢复、逻辑删除与安全清理；方案 B 读取租约、正式 Host 单实例与 D1–D8 真实中断恢复验收完成。PR #80 合并；已完成操作重试修复由 PR #81 合并，CI 通过。BUG-023 已关闭；文档状态同步见当前收尾 PR。详见 [126](126-devlog-f13-1a-design.md)、[129](129-devlog-f13-1a-interruption.md)、[133](133-bugfix-bug-023-replayed-operation-result.md) |
| ✅ | F13.1a Step C 可靠保存与安全清理 | 原始资产与读取安全 | Agent 发布的文件可可靠保存，读取、替换和删除互不破坏，失败后可恢复 | 共享生命周期内核已合入 master（PR #80）；实现与验证边界见 [127](127-devlog-f13-1a-kernel.md) |
| ✅ | F13.1a Step D 进程中断后恢复可验证 | 资产一致性与异常恢复验收 | 突然终止后重新启动仍可读取已提交资料，并安全回收未提交副本 | D1–D8 专项、两次正式 Host 重启及相同操作重试通过；本机完整套件与对应代码 head CI 通过。验收范围与边界见 [129](129-devlog-f13-1a-interruption.md) |
| ✅ | F13.1b 正文提取与处理恢复 | 正文处理、状态与恢复 | 已保存资料能按支持范围提供正文，并明确处理结果及失败恢复 | 保存成功与正文可用分开；替换后不混用旧正文；处理中断可恢复、失败可显式重处理；不承担检索索引与 Agent 检索决策。冻结设计见 [134](134-devlog-f13-1b-design.md)，实现见 [135](135-devlog-f13-1b-content.md)；PR #87 已合并，CI run `39542644391` 成功，本机 typecheck 与 891 项完整测试通过 |
| 🔄 | F13.2 项目资料库浏览与组织 | 资料目录、分类与访问范围 | 用户能看清项目资料，通过文件夹、格式、来源与可用状态组织资料 | 目录与资料管理后端及桌面公共能力已完成，正式 Renderer 页面与交互验收仍待前端实施；不扩大 Resource 权限 |
| ✅ | F13.1c 用户资料补充与管理接入 | 可信用户主体、用户资料导入与公共 RPC | 用户能将本地参考资料补充进项目资料库，并由可信用户主体管理资料 | 固定 User principal 与可信用户入口；支持单文件、多文件及目录导入，保留相对路径并复用 F13.1a 生命周期；用户导入资料默认对同一 Project 内所有 Node 可用；部分成功保留、取消不回滚已保存项、保存失败可重新提交；正文处理由 F13.1b 接管；不新增 UserID、createdBy/sourceKind 字段或 Renderer 页面，资料浏览与文件夹管理由 F13.2 承接。本机 typecheck 与 897 项完整测试、PR #88 代码 head CI 通过；见 [137](137-devlog-f13-1c-user-intake.md) |
| ✅ | F13.2a 目录浏览与资料整理 | 项目目录与资料管理 | 用户能浏览目录与资料信息，创建和整理文件夹，修改、移动和删除资料 | 重名、相对路径、非空目录删除确认及用户 / Agent 操作边界符合 F13.0；不扩大既有 Node 权限。技术设计见 [138](138-devlog-f13-2a-design.md)，实施与验证见 [139](139-devlog-f13-2a-library-organization.md)；本机 typecheck、909 项完整测试及 PR #89 当前代码 head CI 通过，已合入 master |
| ✅ | F13.2b 桌面资料管理交接 | Host / RPC / Electron 公共能力 | 桌面能查询和管理资料，并跟随导入与处理状态 | 版本化公共契约、Host / Electron Bridge、严格运行时校验、错误与按窗口取消清理已实现；真实 Bridge 调用、本机完整测试与 PR #90 当前 head CI 通过，已合入 master；不替代正式页面验收，见 [140](140-devlog-f13-2b-desktop-resource-management.md) |
| 🔄 | F13.3 内容检索与原文定位 | 权限内搜索、结果与原文阅读 | 用户能用问题或术语找到相关资料卡片，Agent 可获得相关片段并继续读取正文 | 后端当前主线；F13.3a 设计与 F13.3b 索引已完成，F13.3c 已合入，F13.3d 本机完整 980 项与 PR #93 CI 通过并已合入，见 [147](147-devlog-f13-3d-retrieval.md)。公共 RPC、Electron Bridge 与正式搜索页面尚未交付。功能边界为权限内文件信息 / 正文检索、来源片段与正文读取；无结果与处理失败可区分；无权资料的标题、片段和正文均不泄露；正式搜索与资料定位体验由前端验收。状态交接见 [141](141-devlog-f13-2-handoff-f13-3.md) |
| ✅ | F13.3a GraphRAG 技术设计 | 图谱检索与资料证据架构 | 冻结支持语义召回、实体关系检索和可追溯原文的 GraphRAG 后端方案 | 核心设计方向已确认，见 [142](142-devlog-f13-3a-graphrag-design.md) |
| ✅ | F13.3b Chunk 与 Embedding 索引 | 文本切分、向量化与语义检索 | 将当前正文转换为可追溯 Chunk，批量生成并持久化 Embedding，建立语义检索基础 | Schema v6、确定性 Chunker、独立 Qwen3-compatible Provider、可恢复原子构建与权限内有界 Top-K 已实现；Node 24 typecheck、仓库全部 146 个 spec 文件 / 933 项及 PR #91 代码 head CI 通过。冻结设计见 [143](143-devlog-f13-3b-chunk-embedding-design.md)，实施见 [144](144-devlog-f13-3b-chunk-embedding.md)；后续 4B / 2560 维真实 Embedding 小规模 smoke test 已通过，见 [151](151-bugfix-bug-030-embedding-deployment.md)；PR #91 已合入 master。FTS5 / BM25、图谱、公共 RPC 和 UI 均未提前实现 |
| ✅ | F13.3c 实体关系抽取与图谱持久化 | 项目内图谱与来源证据 | 从当前资料批量抽取实体关系，保留独立来源，支持权限隔离、替换删除与失败恢复 | 按冻结设计完成实现，专项 40 项、typecheck 与完整 963 项（含 BUG-024）通过，PR #92 最新 head CI 通过，已按用户授权合入 master（de2bb17），见 [146](146-devlog-f13-3c-graph.md)；不做混合检索、多跳、社区或公共 RPC |
| ✅ | F13.3d 混合与图局部检索 | 权限内资料召回与来源路径 | 用户问题可匹配语义与实体关系，获得全局限量且按资料归并的原文片段和最多两跳来源路径 | BUG-026 双路精简与全局 Chunk Top-K 已随 PR #94 合入，本机完整 985 项与代码 head CI 通过，见 [149](149-bugfix-bug-026-retrieval.md)。首次交付：内部混合入口、权限与目录隔离、当前来源定位已实现；本机 typecheck、新增 17 项及完整 980 项通过，PR #93 当前代码 head CI 成功并已合入 master（0c86f7e），见 [147](147-devlog-f13-3d-retrieval.md)。不包含公共 RPC、Electron Bridge、Renderer 或真实模型质量评测 |
| 🔄 | F13.4 Agent 按需使用资料 | Main / Node 任务资料使用与过程可见性 | Main / Node 能围绕信息缺口自主选择搜索、阅读与补充查找，已有证据可直接使用，明确要求查阅时不得跳过 | Main / Node 各自在可见范围内使用资料；实际使用过程可追溯；证据不足与来源冲突明确呈现；资料中的指令不扩大任务授权；不因资料变化隐式启动回合 |
| ✅ | F13.4a 统一 Turn Context | Main / Node 当前任务上下文 | 每次模型请求都能看到当前权威任务状态和必要提醒，长期历史保持可压缩与可恢复 | 固定角色规则与动态状态分离；Turn 内变化下一请求可见，提醒不重复写入历史；Main / Node 可见范围隔离；现有资料可发现性暂保留。本机 typecheck、完整 996 项、diff 检查及 PR #97 最终代码 head CI 全部通过，已合入 master（5bdf3f3）；见 [152](152-devlog-f13-4a-turn-context.md)。后续 F13.4c 移除过渡目录；F13.4b Working Board 取消独立实现 |
| ✅ | F13.4c 资源目录与按需检索 | Main / Node 权限内资料发现与阅读 | Agent 可按目录浏览资料、按主题查找证据，按需阅读原文，已知有效资料可直接使用 | 权限过滤先于筛选与分页；空结果与检索失败可区分；Main / Node / Main Review 可调用；完整目录与资源 ID 枚举不再自动注入；保留新增资料提醒、取消、恢复及执行层权限。实现与验证见 [153](153-devlog-f13-4c-resource-discovery.md)，本机 typecheck、158 文件 / 1032 项完整测试、diff 检查及 PR #98 最终代码 head CI 全部通过，已 squash 合入 master（4de60fe） |
| ⏸️ | F13.5 成果引用与来源核验（已取消） | 暂不建设独立的成果—Resource 追踪体系 | 仅在实际使用出现明确需求时重新评估 | 2026-10-26 用户决定取消独立阶段：不新增持久化引用关联、来源版本追踪、资料变化通知或专用引用 RPC / Bridge；已有回答与成果不因源资料删除而回滚。保留普通 Resource 读取权限与历史工具调用记录 |
| 🔄 | F13.6 完整任务验收 | 端到端集成、真实任务与产品闭环验收 | 验证资料库是否真正帮助 Main / 多个 Node 完成跨资料的长期任务，而不只是能搜索 | 覆盖规划与执行、按需目录 / 检索 / 原文读取、成果交付与 Main 审查；验证资料不足、权限隔离、检索失败、取消与重启恢复。分别记录离线测试、真实模型任务、Bridge 与正式 Renderer 的证据；不得把后端测试或 Bridge 通过等同于完整产品验收 |

### 交付顺序与依赖

- 按 F13.0 → F13.1 → F13.2 → F13.3 → F13.4 → F13.6 推进；F13.5 已于 2026-10-26 按用户决定取消，不作为 F13.6 的前置依赖。F13.6 是当前 F13 计划中最后一个集成验收阶段，但必须明确覆盖仍未完成的正式 Renderer 页面 / 交互验收，不把现有后端能力或 Bridge 验收视为 UI 已完成。各步骤仍需按独立功能范围授权，不授权自动连续实施。
- F13.1 按原始资料生命周期 a、正文处理与恢复 b、用户资料接入 c 顺序推进，全部功能与对应验收完成后才收口父项。F13.1a 已合入 master；F13.1b 已随 PR #87 合并并完成本机与 CI 验证，见 [135](135-devlog-f13-1b-content.md)；F13.1c 本机与 PR #88 代码 head CI 验证通过，见 [137](137-devlog-f13-1c-user-intake.md)。父项还需桌面入口与交互验收。F13.2、F13.3 各自先完成 a 的功能再完成 b 的桌面交接，全部子项与对应验收完成后才收口父项；F13.5 已取消独立实施。F13.2a 已完成并随 PR #89 合入，见 [139](139-devlog-f13-2a-library-organization.md)；F13.2b 公共 RPC、Electron Bridge 与实际调用验收已完成，见 [140](140-devlog-f13-2b-desktop-resource-management.md)。2026-10-22 用户确认不新增 F13.2c；F13.2 父项仍待 Renderer 页面与交互验收，但不阻塞后端继续推进 F13.3a。
- 后端负责资料能力、权限、检索与 Agent 使用；前端负责导入反馈、资料库页面、用户侧搜索与定位。F13.2b 已交付资料管理公共能力；F13.4c 的 list_resources / search_resources 是 Agent 内部工具，不等于用户侧搜索 RPC 或 Renderer 页面已完成。F13.5 的引用公共契约与变化提示已取消，不作为 F13.6 的前置依赖。未来若新增跨端契约，仍须串行确认版本、运行时校验、错误、取消和兼容语义。
- F5.4–F5.8 保持原状态；F13 资料库信息面板与 F5.7 使用同一资料信息，不扩展 F5.7 的文件管理范围。Node 对话与成果引用的正式 UI 验收依赖对应 F5 页面交付；不将该依赖默认为已完成。F13.0 整体产品设计已获用户确认；后续功能与页面仍须分别实施和验收。

Coding 与 Learning 作为后续 Mode Adapter 验证 Core 通用性，不恢复为独立产品主线。

## 12. 当前下一步

2026-10-28 优先级更新：按用户要求新增 Phase 15 MCP 外部工具支持，当前下一步调整为 F15.1；先完成 MCP 工具接入，再开展 AppWorld 长程评测。F14.6–F14.9 保持待实施，前端状态不变。本次仅授权更新计划，未授权开始 MCP 代码或真实模型实验。分步范围见第 14 节与 [182](182-devlog-mcp-plan.md)。

2026-10-26 最新复验：用户决定搁置 BUG-032，改用 OpenRouter；分别授权三轮真实任务。验收单次时限按授权改为 60 秒，并修正遗漏 Main 目标确认回合的 BUG-034。第三轮 6 次 Embedding 全 200，三份原文与成果图谱 active，BUG-031 旧参数错误未复现；Main 规划、Node A、Main Review、定向共享、同库重开通过。Node B 虽读取交接与约束，却额外声明两份未直接 fetch 的原文为来源，严格判据拒绝，登记 BUG-035；最终 Main Review 尚未执行，F13.6 保持进行中。该失败已确认为验收脚本来源契约缺陷，现按方案 A 修复：直读由成功 fetch 轨迹证明，source_ids 只要求包含必读来源并可追溯。第四轮真实完整任务已通过：现场 `%TEMP%/navo-f136-real-R8uzdx`，282093ms，生成 22 次（图谱 5）、Embedding 7 次全部 200，两 Node 与最终 Main Review 完成；BUG-031 / 033 / 034 / 035 关闭。F13.6 后端完整链路通过，父项仍待正式 Renderer 验收，正式 Renderer 状态不变；PR #105 已 squash 合入 master（`9f3514e`）。记录见 [160](160-devlog-f13-6-openrouter-acceptance.md)、[163](163-bugfix-bug-035-node-source-evidence.md)。下述独立 smoke 与此前失败均保留为历史，不表示完整任务通过。

2026-10-26 新增能力已验收：可显式选择 OpenRouter Nemotron 3.5 Embed 1B 免费模型，保留原 Qwen 能力。本机完整 1045 项、最终 head CI 与授权真实 Embedding 链路均通过：10 次 HTTP 200、2048 维、索引 / 中英文检索 / 权限 / 重启复用通过，耗时 6.99 秒，生成调用为 0；PR #104 已合入 master（4db37c6），见 [159](159-devlog-embedding-openrouter.md)。本次授权仅限 Embedding，不继续图谱 / 两 Node / Main Review；F13.6 仍为进行中，后续等待单独授权。BUG-032 的原端点问题与 BUG-031 的真实图谱复验保持原状态。

**Phase 10、M1、Phase 11 与 Phase 12（F12.0–F12.7）均已完成对应后端验收。

**此前真实失败（2026-10-26）：F13.6 修复后的首次复验中，类型检查、46 项专项和零推理预检通过；真实运行在原 Qwen Embedding 连接阶段失败（32.42 秒、3 次未收到 HTTP 响应、生成调用为 0），BUG-032 见 [158](158-bugfix-bug-032-embedding-connectivity.md)。图谱 / Main / Node / Review 未运行；用户现已授权仅合并 PR #100 的离线验收资产与失败记录，F13.6 仍未完成。BUG-031 参数修复已随 PR #102 合入；历史验收与修复见 [156](156-devlog-f13-6-backend-acceptance.md)、[157](157-bugfix-bug-031-graph-subscription.md)。新增 OpenRouter 路径已按上文独立验收，不表示恢复了原 Qwen 端点；前端由用户另行安排。**

**此前完成状态（2026-10-24）：BUG-027–029 候选事务、名称匹配与融合分数修复已完成，专项 24 项、类型检查、完整 987 项及 PR #95 代码 head CI 通过，已合入 master（83c54fa），见 [150](150-bugfix-bug-027-029-retrieval.md)。BUG-026 双路检索与全局 Chunk Top-K 修复已随 PR #94 合入 master（408a83c），本机 typecheck、985 项完整测试与代码 head CI 通过，见 [149](149-bugfix-bug-026-retrieval.md)；后续 Step 等待单独授权。F13.3d 混合与图局部检索已完成，新增 17 项回归、typecheck 与完整 980 项通过，PR #93 代码 head 6898b88 的 CI run 40102211673 成功，已 squash 合入 master（0c86f7e），见 [147](147-devlog-f13-3d-retrieval.md)。F13.3b/c 已合入；后续检索公共接口与 Electron Bridge 等步骤仍需单独授权，本轮不启动。真实 Embedding 小规模 smoke test 已通过（4B / 2560 维，见 [151](151-bugfix-bug-030-embedding-deployment.md)），真实图谱抽取、规模与检索质量评测未运行；首轮 Fetch 超时留在 BUG-025 继续跟踪，未定位、未修复，不声称关闭。**F12.7 最新 gpt-6-luna 真实 28 请求 / 3 次压缩、暂停交接 / 同库重启及两 Node / Main 完整通过，本机 793 项与代码 CI 通过，见 [117](117-devlog-f12-7-acceptance.md)。BUG-014 / 015 / 016 / 017 关闭，BUG-018 已随 PR #79 合入关闭。BUG-019 通用传输诊断缺口仅排查、未修复；本轮成功不证明网络持续稳定。F13.0 产品设计已收口，见 [125](125-devlog-f13-0-design.md)；F13.1a 已完成并合入 master，F13.1b 已随 PR #87 合并（提交 `845b864`），CI run `39542644391` 成功，本机 typecheck 与 891 项完整测试通过，见 [135](135-devlog-f13-1b-content.md)。F13.1c 后端能力已实现，本机 typecheck 与 897 项完整测试、PR #88 代码 head CI 通过，见 [137](137-devlog-f13-1c-user-intake.md)；F13.2a 后端实现已随 PR #89 合入，见 [139](139-devlog-f13-2a-library-organization.md)；F13.2b 公共 RPC、Electron Bridge、本机 912 项完整测试与真实 Bridge 调用验收已完成，见 [140](140-devlog-f13-2b-desktop-resource-management.md)。F13.1 与 F13.2 父项仍待正式 Renderer 入口和交互验收。BUG-019 保持仅排查，不阻断产品设计。前端 F5.4–F5.8、正式页面 AutoRun / 上下文 UI 不因此视为完成。**

- 免除记录：F10.4b 真实模型五场景验收与 F10.5 第 7–11 回合真实验收均经用户决定免除，相应能力只由离线测试覆盖，见第 7 节。
- 未关闭 Bug（以 [Bug 跟踪表](bug-plan.md) 为准）：BUG-002 等待复现，BUG-007 经用户决定搁置，BUG-010 待 Qwen / Electron 验收，BUG-019 仅排查，BUG-025 固定地址 HTTP 测试偶发超时待定位，BUG-032 原 Qwen 端点由用户决定搁置。BUG-031 / 033 / 034 / 035 已随第四轮真实完整任务通过关闭。
- 前端依赖：F10.4a / F10.4b 的公共契约变化与控制节点移除已同步到 [前端计划](frontend-plan.md) F5 交接说明，前端展示由 F5.4–F5.8 接入。


## 13. Phase 14：前端 F6–F11 必要公共交接

2026-10-26 用户在目标模式明确授权完成前端至 F11，并选择将直接需要的后端交接纳入目标，独立实施与验收。此处仅覆盖前端计划已列出的直接依赖；正文预览、图谱浏览、独立引用管理保持取消。后端子 Agent 负责所属代码，主编排 Agent 为共享控制面唯一写入者，公共契约与合并串行进行。前端页面及交互完成状态仍由 `frontend-plan.md` 记录。

| 状态 | 步骤 | 职责范围 | 功能目标与完成标准 |
|---|---|---|---|
| ✅ | F14.1 项目原会话与中断事实 | 项目会话恢复公共交接 | 桌面能定位 Main 与已有 Node 的原会话，区分尚未建立、无权或不可读取，并取得最近已保存回合的状态与可信中断原因；读取不新建会话、不运行回合、不重放工具，重启后仍可查询。版本、校验、错误、取消及兼容语义明确，离线及真实 Host 调用通过 |
| ✅ | F14.2 资料查看副本与重新处理 | 用户资料使用公共交接 | 用户可显式重新处理正文失败资料、取消目标处理，并取得权限内当前资料的查看副本；删除或替换后的请求语义明确，不公开内部资产路径，不自动回写外部修改，Host 调用验收通过 |
| ✅ | F14.2a 当前资料查看副本 | 用户资料打开 | 用户可取得权限内当前版本的独立查看副本，资料原件不暴露给 Renderer，外部编辑不回写；版本冲突、替换 / 删除竞态与取消明确，真实 Host 调用通过 |
| ✅ | F14.2b 失败正文显式重处理 | 用户资料异常处理 | 用户可对当前失败资料显式重新排队，版本与代次冲突可辨识，已有跟随可看到实际处理结果，不自动启动 Agent 或补跑其他资料 |
| ✅ | F14.2c 目标正文处理取消 | 用户资料处理控制 | 用户可取消指定资料当前代次的正文处理，不能误取消其他资料；请求取消与任务取消结果分别明确，重启仍采用既有恢复事实 |
| ✅ | F14.3 用户资料搜索与索引状态 | 资料查找公共交接 | 用户能搜索全项目或文件夹及后代，按文件归并并分页、定位资料；权限过滤先于搜索与分页，文件信息与内容检索状态可区分，结果变化可识别；正式 Host 可使用已配置的检索与图谱能力，失败、取消与重启通过验收 |
| ✅ | F14.3a 用户目录查询与当前处理状态 | 用户资料查找与分页 | 用户能按名称 / 描述和目录后代查找资料、稳定分页，看到当前正文与兼容索引状态；用户范围保留项目全部活动资料而不冒充 Main，页面与查询变化可识别，重启不凭空制造变化；旧资料接口保持可用 |
| ✅ | F14.3b 用户问题检索 | 用户内容检索交接 | 用户能按问题检索项目或目录及后代，按文件归并结果、稳定分页与定位；无结果、尚未处理、检索未配置与失败可区分，替换 / 删除 / 权限变化后旧结果可识别；翻页不重复执行检索，取消和重启后的结果有效性明确 |
| ✅ | F14.3c 正式 Host 显式图谱抽取配置 | 内部图谱检索能力交接 | 正式 Host 可显式启用已支持的图谱抽取模型，用户能分辨抽取未配置、现有图谱可读、处理中与失败；不默认沿用 Main 模型，配置或当前图谱变化后旧搜索结果可识别；不做图谱浏览、正文预览或独立引用 |
| ✅ | F14.4 自动运行持续观察 | 自动任务与内容公共交接 | 桌面能按项目与运行身份观察 AutoRun 状态和自动 Main / Node 回合的实际公开内容，辨识结束、求助与暂停；订阅取消与关闭释放资源，订阅本身不启动任务，不承诺进程内旧运行可跨重启恢复 |
| ✅ | F14.5 独立普通会话管理 | 长期普通聊天公共交接 | 用户能新建、分页查找、重命名、归档及恢复普通会话，身份与归属持久保存；打开不执行，活动回合与归档冲突可辨识，Main / Node 不被普通会话操作修改，既有普通会话明确迁移 |
| ⬜ | F14.6 原始公开历史与查找导出 | 会话档案公共交接 | 用户能分页阅读已保存的消息、工具往返、回合终态及压缩记录，查找当前会话文字并导出明确选定的会话；压缩前原文保留，缺失或损坏明确提示，系统提示词、凭据与内部日志不公开 |
| ⬜ | F14.7 可信账号与模型目录 | 桌面登录公共交接 | 用户可查看公开账号状态、显式开始或取消浏览器登录、退出本地账号并取得实际可用模型；令牌由可信账号服务保管，操作失败与取消明确，活动任务时的限制可验证，不改变其他用户环境 |
| ⬜ | F14.8 模型配置持久化与显式应用 | 应用模型设置公共交接 | 用户可查看已保存和实际生效的配置并在空闲时显式应用，后续回合使用确认的模型；活动回合、压缩或 AutoRun 时拒绝切换，不改写历史，生成模型与嵌入模型分开，命令与桌面遵循同一生效语义 |
| ⬜ | F14.9 项目归档与重新打开 | 项目生命周期公共交接 | 用户可按当前版本归档空闲项目并只读查看，再显式重开原身份与目录；执行、压缩、AutoRun 或资料变更冲突可辨识，归档只读由后端执行，缺失目录不静默重绑，重启后内容保持且不自动执行 |

F14.1 已随 PR #107 合入 master（f1ed357），本机完整 1065 项、正式 Host 零推理重启查询与当前 head CI 均通过，见 [165](165-devlog-f14-1-session-recovery.md)。当前交接进入 F14.5；按前端依赖次序推进，已经授权连续实施，但每步仍独立分支 / PR、本地完整验证、当前 head CI、记录及审查。模型与外部服务验收按每批公开预算执行，失败保留证据，不通过新增重试或绕过检查掩盖失败。

F14.2a 已随 [PR #108](https://github.com/likeWind221/Navo/pull/108) 合入 master（528e3a1），本机完整 1070 项、正式 Host 零推理查看副本与最终 head CI 通过，见 [166](166-devlog-f14-2a-view.md)。前端 F7.3 消费另行验收。

F14.2b 已随 [PR #109](https://github.com/likeWind221/Navo/pull/109) 合入 master（c7999b3），本机完整 1076 项、正式 Host 零推理重处理与最终 head CI 通过，见 [167](167-devlog-f14-2b-content.md)。后续 c 的结果见下方交接。

F14.2c 已随 [PR #110](https://github.com/likeWind221/Navo/pull/110) 合入 master（124998d），本机完整 1080 项、正式 Host 零推理接口检查与当前 head CI 通过，见 [171](171-devlog-f14-2c-cancel.md)。F14.2 公共交接父项完成；前端 F7.3 尚未消费。F14.3a 已随 [PR #113](https://github.com/likeWind221/Navo/pull/113) 合入 master（11984aa），本机完整1089项、正式Host零推理目录查询与重启检查及当前head CI全部通过，见 [172](172-devlog-f14-3a-query.md)。F14.3b已随 [PR #114](https://github.com/likeWind221/Navo/pull/114) 合入（02a9951），本机完整1104项、正式Host受控/持久图谱读取与当前head CI通过，见 [173](173-devlog-f14-3b-search.md)。F14.3c及父项已完成，当前下一步F14.5普通会话管理。

F14.3c 已完成本机类型检查、完整1112项与正式Host受控验收，见 [174](174-devlog-f14-3c-graph-host.md)。PR #115当前head 74f256b的CI 40382364662通过，已squash合入784246a；F14.3父项与c收口，后续接续F14.4，前端F7.4另行消费。

F14.4 已在独立分支实施。范围保持自动运行状态和用户可见回合内容的持续观察、订阅取消与关闭清理；不改自动执行规则、暂停恢复预算或跨重启持久化。具体交付需通过独立PR、完整本机与当前head CI后再收口。

F14.4本机完整1118项与正式Host受控观察/暂停/恢复/重启/关闭验收通过，见 [176](176-devlog-f14-4-observation.md)，PR #117 head a366594的CI 40386332385通过，已squash合入12ffa7a；前端F8仍未消费。

F14.5 已完成本机类型检查、完整 1130 项、31 项专项与正式 stdio Host 零推理 create/list/rename/archive/restore/restart 验收，见 [177](177-devlog-f14-5-ordinary-sessions.md)。[PR #118](https://github.com/likeWind221/Navo/pull/118) head `bbc04a7` 的 CI `40444187477` 通过，已 squash 合入 `a185778`。

此前下一步（2026-10-28 调整前）为 F14.6 原始公开历史与查找导出：分页阅读消息、工具往返、回合终态与压缩记录，支持当前会话文字查找与显式选定导出；不公开系统提示词、凭据或内部日志。原始历史是后续会话 UI 与导出的公共事实源，不改变 F14.5 的普通会话身份与归档语义。

## 补充：DeepSeek Flash 生成模型接入

| 状态 | 能力 | 完成标准 |
|---|---|---|
| ✅ | DeepSeek Flash 后端生成与真实验收选择 | 正式 Host 和验收可显式使用 DeepSeek，工具调用、思考历史、错误与取消正确，图谱可独立配置；离线检查和当前 PR head CI 通过。真实 API 兼容性与模型质量单独验收 |

开发记录见 [180](180-devlog-deepseek-flash.md)。本次不推进 F14.6 或评测集开发；外部模型调用需先给预算。

DeepSeek 接入本机完整 183 文件 / 1138 项、类型检查及 PR #120 代码 head 78c0689 CI 40662081402 已通过；真实 API 连通与质量尚未验证。

## 14. Phase 15：MCP 外部工具支持

**目标：** Navo 可从显式配置的 MCP 服务发现工具，让普通 Agent、Main 和 Node 在各自授权范围内调用，并保留可追溯结果、取消与连接生命周期。先支持 AppWorld 所用远程 HTTP 服务，再覆盖本地进程工具；能力属于通用 Agent 内核，不依赖 Research Workspace。

| 状态 | 步骤 | 职责范围 | 功能目标与完成标准 |
|---|---|---|---|
| 🔄 | F15.1 发现可用外部工具 | 可信服务连接与工具目录 | 后端可连接显式配置的远程 MCP 服务，取得全部分页工具及名称、描述、参数规则；工具来源可辨识，同名工具不冲突；版本或参数规则不支持时明确说明，不悄悄放宽。目录变化可刷新，活动调用与后续回合看到的工具边界明确；凭据不进入模型或公开记录 |
| ⬜ | F15.2 按权限执行外部工具 | Agent 工具使用与调用记录 | 普通 Agent、Main、Node 只看到并调用其被授予的外部工具；发现不等于授权，身份由可信会话绑定。参数、返回结果、工具自身错误、协议失败与取消可区分，文本和结构化结果可读取，不支持的内容明确提示；调用来源与结果可追溯。撤销授权后后续调用拒绝，超时或断线不自动重复有副作用的调用；取消不冒充远端操作已撤销，关闭释放连接 |
| ⬜ | F15.3 AppWorld 端到端工具验收 | 通用长程任务评测交接 | Navo 可通过 AppWorld 官方 MCP 发现并调用任务工具，由 Main 规划、Node 操作环境和 Main 审查完成一次可追踪流程；任务初始化、保存与官方评分由独立评测运行器负责，判分材料不提供给 Agent。受控协议与权限验收通过后，再按单独授权预算做真实 Flash 试运行；接入验收不冒充正式 benchmark 成绩 |
| ⬜ | F15.4 使用本地 MCP 工具 | 受控本地服务生命周期 | 后端可使用显式配置的本地 MCP 服务，并复用相同的发现、授权和调用行为；进程参数与环境仅由可信配置提供，协议输出与诊断可区分，启动失败或退出可辨识，关闭清理自己启动的进程，不终止外部服务 |

**顺序与边界：** F15.1 → F15.2 → F15.3 → F15.4。先交付远程发现与执行并验证 AppWorld，再补本地服务；AppWorld 不依赖 stdio 完成。远程能力采用 Streamable HTTP，本地能力采用 stdio；实施时固定协议版本、SDK 和兼容范围，具体决策记开发记录。F15.3 另需已验证的 AppWorld 隔离环境及真实试运行授权。

MCP 首期仅做客户端工具能力，不包含 Navo 对外提供 MCP Server、Resources / Prompts、Sampling / Elicitation、OAuth 浏览器授权、插件市场、桌面配置页面或 Codex / Claude Code 的个人 MCP 配置。服务端描述及 annotations 不授予权限。AppWorld 初始状态、环境独占与官方判分继续由运行器控制，MCP 不替代该职责。

**当前下一步：** F15.1 远程工具发现实施中，采用官方 TypeScript MCP Client SDK `@modelcontextprotocol/client` 2.4.0 与 Streamable HTTP；可信环境配置入口为 `NAVO_MCP_SERVERS_JSON`。本分支仍需本地完整验证及当前 PR head CI 后才能收口。F14.6–F14.9 保留原待办；后续桌面消费若需要公共契约，另按前后端边界排期。设计决策见 [182](182-devlog-mcp-plan.md)，实现记录见 [183](183-devlog-f15-1-mcp-discovery.md)。
