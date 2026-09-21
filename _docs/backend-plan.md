# Navo 后端与 Agent Core 开发计划

> 当前产品定义以 `_docs/00-navo-prd.md` 为准。Phase 0–8 保留为已完成的通用执行基础；自 Phase 9 起，后端主线转向面向长期 Project 的 Roadmap、Main Agent 协调与隔离 Node Agent 执行。

## 1. 当前范围

Phase 0–8 已完成 Session / Event、LLM、ToolService、AgentRuntime、Search / Fetch、文件工具、Node 原型、Kernel Host 与桌面 Agent 链路等基础能力。Phase 9 不重写这些执行基础，而是在其上建立长期 Project 级编排。

当前阶段：

```text
Project Goal
    |
    v
In-Memory Roadmap Map
    |
    +---------------------+
    |                     |
    v                     v
Main Agent            Project Nodes
(global planning)     (isolated work units)
    |                     |
    |                 Node Profiles
    |                     |
    +----------+----------+
               v
          AgentRuntime
               |
        LLM / ToolService
```

Phase 9 的目标不是把 Roadmap 塞进一次 Agent 会话，也不是建立一个以 Scheduler 为中心的全自动工作流引擎，而是让一个 Project 能够长期存在、持续演进，并由一个 Main Agent 管理整体路线、多个相互隔离的 Node Agent 执行节点工作，同时保留 Human 对每个 Node 是否真正开始执行的明确控制权。

## 2. Phase 9 核心产品契约

### Project 是长期生命周期边界

Project 是长程目标的一级对象。Project 的 Goal、Roadmap、Main Agent 上下文、Node 集合、消息、Project Asset 和项目进度都应独立于单个 Turn 或单个 Session 长期存在。Session 负责 Agent 连续上下文，不承担 Project 全局事实的唯一存储职责。

### Roadmap 是用户与 Agent 共同看到的项目状态地图

Roadmap 是 Project 的权威进度模型，应支持长期展示为看板或“游戏地图”式进度视图。它描述 Node、节点关系、阶段状态、版本和变更历史，而不是 Main Agent 内部的一段临时计划文本。

F9.3 以无环有向图表达路线，暂不实现循环。Core 需要表达必选节点、可选节点、并行汇合、节点跳过与动态插入等语义。当前是否可推进某 Node 是 Roadmap 状态的确定性结果，不单独把 Scheduler 提升为产品架构中心。

### Navo 只保留一个 AgentRuntime

Main Agent 与 Node Agent 不对应两套 Runtime，也不新增固定 Agent 类层级。两种角色都复用现有 `AgentRuntime`，通过不同的 Profile、可信 Binding 和 Session 获得不同职责与权限。

```text
Main Agent = AgentRuntime + Main Profile + Project Binding + Main Session
Node Agent = AgentRuntime + Node Profile + Node Binding + Node Session
```

Profile 决定模型看到的角色说明和工具集合；Binding 与领域授权负责实际资源边界。禁止仅依赖 Prompt 声明安全隔离。

### Main Agent 是唯一跨节点协调者

Main Agent 负责理解 Project Goal、规划与修改 Roadmap、协调 Node、处理阻塞和全局重规划。Node Agent 只负责自己的 Node，不读取其他 Node Agent 的 Session，不直接读取完整 Roadmap，也不能直接向其他 Node Agent 发消息。

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
  +--> access: private | shared(nodeIds) | project
  +--> entryRef / revision
  |
  +--> private in-memory Store (F9)
```

Main 后续负责把 Resource 从 private 定向共享给指定 Node，或提升为 Project 共享。Node 启动时只需要持续知道自己可见的 Resource metadata，正文按需读取；Resource 到位仍不会自动启动 Node。通用 Context Builder、动态 reload 与 RAG 不在 F9.6 实现。

### Human 是 Node 执行的最终 Gate

Navo 不以“依赖一满足就自动跑下一个节点”为目标。Roadmap 解锁、收到 Main directive、收到 Asset 或收到 Mailbox 消息，都不得自动触发 Node Agent Turn。

```text
Node ready
   |
   X  no auto-run
   |
Human explicit start
   |
   v
Node working
```

Node 报告 result 也不等于 Node 已完成；F9.2 的人工确认 completing / skipped 规则继续生效。

### 现有 Node 包是 Phase 9 的迁移基础

现有 `src/node` 已验证 Node 事件流、严格重放、Node–Session 一对一绑定、同 Node FIFO、跨 Node 并行和 Session 来源授权。这些能力继续作为通用 Project Node 的基础。Phase 9 会剥离其中 SkillWorld 的教材、练习与 capability 专属语义，而不是绕过现有 Node 重新建立平行 Task 系统。

## 3. 开发方式

- 后端 Agent 只修改 `_docs/backend-plan.md`、`src/**`、`tests/**`、`scripts/**`、根 `package.json`、根 `pnpm-lock.yaml` 及明确分配给后端的开发记录；不修改 `frontend/**`。
- 每个 Step 都从最新 `master` 创建独立分支；Agent 完成开发后创建指向 `master` 的 PR，不直接向 `master` 提交功能改动。
- PR 以 GitHub CI 作为唯一合并 gate，固定执行 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`。
- CI 失败时由 Agent 在同一 PR 分支修复并触发 CI 重跑；CI 全部通过后直接 Merge 到 `master`，不再设置单独的 Human Review / 人工审查 gate。
- 只有当前 Step 的 PR 已通过 CI 并合入 `master` 后，才开始下一 Step。

```text
Agent 开发
   |
   v
创建 PR
   |
   v
GitHub CI
├── pnpm install
├── pnpm typecheck
└── pnpm test
   |
   +-- FAIL --> Agent 修复 --> CI 重跑
   |
   +-- PASS
        |
        v
      Merge
        |
        v
      master
```

- 计划只写功能目标与可验收结果；模块划分、协议字段、算法和文件级实现取舍写入对应开发记录。
- Phase 9 优先确定可重放、可测试和权限明确的 Core，再接入真实 LLM 主规划行为。
- `AgentRuntime`、`ToolService`、`SessionStore` 继续保持通用命名，不为 Multi-Agent 新增重复 Runtime。
- 当 Phase 9 首次需要修改 Host、RPC、桌面共享契约或前端消费协议时，后端停止实现并先向用户报告，由前后端串行确认公共契约后再继续。
- `_docs/00-navo-prd.md`、`_docs/index.md`、`_docs/frontend-plan.md` 与其他共享控制面不在当前后端独立修改范围内。

## 4. 状态说明

- ⬜ 未开始
- 🔄 进行中
- ✅ 已完成
- ⏸️ 延期
- ⛔ 阻塞

## 5. 已完成基础：Phase 0–8

下表只保留历史能力事实，不重新解释旧 SkillWorld 产品路线；详细实现和当时的阶段边界以对应 devlog 为准。

| Phase | 状态 | 已形成的通用能力 | 当前用途 |
|---|---|---|---|
| 0 | ✅ | TypeScript、Node、pnpm、Cordis 工程骨架 | Core 运行与模块装配基础 |
| 1 | ✅ | 品牌化 ID、LLM / Tool 公共协议 | Project / Roadmap 新身份继续沿用同一协议风格 |
| 2 | ✅ | SessionEvent、追加日志、消息投影与 Surface | Main / Node Session 的执行记录基础 |
| 3 | ✅ | 流式 LLM、ToolService、Schema、错误与取消边界 | 所有 Agent Profile 共用模型和工具执行面 |
| 4 | ✅ | 通用 `AgentRuntime`、Turn 生命周期、重试、取消、同 Session 串行 | Phase 9 唯一 Agent 执行内核 |
| 5 | ✅ | 应用组合与模型 -> 工具 -> 模型闭环 | Project 级能力向下复用的稳定执行链 |
| 6 | ✅ | NodeEvent / NodeStore、Node–Session 绑定、NodeAgent Profile、跨 Node 隔离 | Phase 9 Generic Node 的主要迁移基础 |
| 7 | ✅ | `web_fetch`、公共网络策略、HTML -> Markdown | Node 工作中的网页调研能力 |
| 8 | ✅ | `read`、`shell`、`edit`、`write`、Fetch spill、文件版本与并发保护 | Node 工作区执行能力 |

桌面侧已有 Kernel Host、真实模型 Adapter、回合与工具事件、会话命令和 RPC 链路。这些属于已完成基础；Phase 9 的 Project / Roadmap 公共契约尚未接入桌面。

## 6. Phase 9（F9）：Project-Oriented Multi-Agent Roadmap Runtime

**阶段目标：** 让 Navo 能把一个长期 Goal 作为 Project 持续管理：Main Agent 维护可视化 Roadmap，多个隔离 Node Agent 分别推进节点；每个 Project 拥有独立 Workspace，Node 的报告、阻塞和 Resource 回到 Project / Main 协调；Main 可以安全修改 Roadmap 并为后续 Node 准备可发现资源，但每个 Node 的真实执行仍由 Human 明确启动。

**阶段验收场景：** 创建 Project 与 Goal；Main Agent 形成多 Node Roadmap；Human 启动 Node A，Node A 在当前 Project Workspace 中生成调研产物、注册 Resource 并向 Main 报告结果；Main 将该 Resource Reference 提供给 Node B；Node B 后续启动时能够持续看到资源元数据并按需读取内容，但不会因为 Resource 到位自动运行；若 Node 在工作中遇到阻塞或 Roadmap 修改要求，只能向 Main 报告 / escalation，不能直接联系其他 Node 或自行修改 Project Roadmap。

```text
Project
  |
  +--> Goal
  +--> Roadmap Board <-------------------------------+
  |                                                  |
  +--> Main Profile + Project Binding + Session      |
  |                  |                               |
  |                  v                               |
  |             AgentRuntime                         |
  |                                                  |
  +--> Project Mailbox <--------- Node reports -------+
  +--> Project Workspace <------- actual files --------+
  +--> Resource Registry <------- metadata / refs -----+
  |
  +--> Node A --------X--------> Node B
  |     Node Profile             Node Profile
  |     + Node Binding           + Node Binding
  |     + Session                + Session
  |
  +--> Human Gate: each Node Turn starts explicitly
```

| 状态 | Step | 职责范围 | 工作内容（功能目标） | 完成标准 |
|---|---|---|---|---|
| ✅ | F9.0 Project Runtime 架构与边界收口 | 后端计划与设计记录 | 明确 Project、Roadmap、Main Agent、Node Agent、单一 AgentRuntime 和通信边界，统一 Phase 9 后续路线 | 后续 Step 不再以 Scheduler / Coordinator 为中心；旧 Node 的复用与迁移方向明确；当前下一步唯一指向 F9.1 |
| ✅ | F9.1 Project Domain | Project 领域 | 让系统拥有独立于单次会话的长期 Project 身份、Goal、主执行上下文和生命周期 | 可以创建、读取和重建 Project，保留唯一主会话归属，并支持归档和重新打开 |
| ✅ | F9.2 Generic Project Node | Node 领域 | 让 Project 拥有通用工作节点，保留独立会话、串行与并行执行，并由人确认节点最终完成或跳过 | Node 不再依赖教材/练习；locked、idle、working、completing、skipped 可重建；模型不能自行完成节点；人工确认检查当前版本；会话隔离和取消通过验证 |
| ✅ | F9.3 In-Memory Roadmap | Roadmap 领域 | 让 Project 在当前运行期间拥有可修改的路线图，记录节点关系、版本与修改历史，并按节点事实维护解锁状态 | 纯内存、不使用数据库；同一历史可重建同一 Roadmap；必选/可选节点、并行汇合、节点跳过和动态插入可验证；地图查询直接返回节点与 edges |
| ✅ | F9.3.1 路线结构与关系表达 | Roadmap 结构与规则 | 让项目能表达工作节点、人工开始/结束/确认节点、必选/可选节点、分叉与汇合，并识别非法关系 | 控制节点无需 Agent 会话且只能人工完成；能表达菱形路线；Node 属性表达必选/可选；无效引用、重复边和结构环被拒绝；循环不在本阶段实现 |
| ✅ | F9.3.2 路线变更与历史重建 | Roadmap 内存状态与变更 | 让调用方创建、查询、插入、调整关系、重排和增删路线节点，并能新增节点接续后续阶段、查看历史 | 整批变更全部成功或不生效，新建节点失败不留孤立节点；旧版本不能覆盖新版本；同一历史重建同一状态；complete/skip 后依赖满足的节点同步 unlock |
| ✅ | F9.3.3 节点地图查询 | Roadmap 查询与领域集成 | 让调用方直接获取节点属性、已提交状态和依赖边以重建地图 | 无 Board 或成员状态；查询不修改节点；数据包含节点与路线版本，前端可据此重建地图 |
| ✅ | F9.4 Agent Profile 与 Binding | Project / Node Agent 角色边界 | 让 Main Agent 与 Node Agent 在同一 AgentRuntime 上获得不同角色、上下文和能力，同时由可信作用域约束实际可访问资源 | Main / Node 不新增独立 Runtime；Profile 不是唯一安全边界；Node 无法通过伪造输入访问其他 Node 或 Project 管理能力 |
| ✅ | F9.5 Main Agent Planning 与 Roadmap Mutation | Main Agent / Roadmap | 让 Main Agent 能基于 Goal 和项目现状读取、创建和修改 Roadmap，并由确定性边界决定方案能否成为新的项目事实 | `read_roadmap`、`read_node`、`write_roadmap`、`modify_roadmap` 完成；陈旧版本、非法关系和跨 Project 访问被拒绝；Main 不拥有 Human completion / skip 权限 |
| 🔄 | F9.6 Project Workspace 与 Resource Handoff | Project 消息、工作空间、资源与跨 Node 协调 | 让每个 Project 绑定用户选择的真实工作目录，Navo 内部文件统一收口到 `.navo/`，并通过稳定 Resource 领域对象、权限和 Main 协调完成跨 Node 资源交接 | 用户项目目录保持纯净；Navo 管理文件只进入 `.navo/`；Resource 身份、来源和权限可追溯；不存在 Node-to-Node 通道；任何 handoff 都不自动启动 Node |
| ✅ | F9.6a Project Mailbox Domain | Project 消息领域 | 建立可重放的 ProjectMessage / Mailbox history，并在领域层限制合法路由为 Node->Main 与 Main->Node | `postFromNode` / `postFromMain` 已形成方向明确的写入边界；Project / work Node 归属、历史连续性和合法路由可验证；跨 Project、control Node、Node-to-Node replay 被拒绝；append message 不依赖或触发 AgentRuntime |
| ✅ | F9.6b Project Workspace Foundation | Project 文件工作空间 | 为每个 Project 建立独立 Workspace 根目录与安全路径解析，作为 Node 文件和后续 Resource 的物理承载层 | 不同 Project Workspace 互相隔离；资源路径以 Project 内相对引用表达；路径逃逸被拒绝；不引入数据库、Registry 或 Agent Tool |
| ✅ | F9.6c Project Resource Registry | Project 资源领域 | 为 Workspace 中的重要产物建立内存 Resource Registry，记录稳定 ID、来源、描述和资源引用，不复制实际内容 | Resource 可 create/get/list by Project；来源 Node 必须属于当前 Project；跨 Project 引用被拒绝；Registry 在 F9 只驻内存，F10 再统一持久化 |
| ✅ | F9.6d.1 Project Workspace Root Migration | Project 文件工作空间 | 让 Project 直接绑定用户选择的真实工作目录，并把 Navo 自身产生的内部文件统一收口到该目录下的 `.navo/`，为代码仓库、论文目录等真实项目提供干净工作区 | Project 可使用任意已有目录作为 Workspace；Navo 基础设施不在 `.navo/` 外散落管理文件；`.navo/assets`、`.navo/nodes` 成为稳定内部目录；Node 文件访问不能逃逸当前 Project Workspace |
| ✅ | F9.6d.2 Resource Lifecycle 与 Access Domain | Project 资源领域 | 把 Resource 收敛为稳定、不可由目录扫描隐式改变的领域对象，通过统一服务管理身份、来源、元数据、内容入口和访问权限，并为 F10 数据库持久化保留稳定接口 | Resource 拥有稳定身份、来源、可修改元数据、内容入口、revision 与 `private / shared / project` 三态访问范围；所有生命周期变化只能经过 Resource 服务；删除不立即销毁物理内容；底层在 F9 仍为内存状态 |
| ✅ | F9.6d.3 Resource Ownership 与 Main Communication Capability | Project Agent 协作能力 | 让 Main 与 Node 都能通过可信 Session Binding 发布并维护自己拥有的正式 Resource；非 owner 对获授权 Resource 只读；Node 可通过单向文本通信把需要进入全局决策的信息发送给 Main | Resource owner 只能来自 Session Binding；owner 可 register/fetch/update metadata/delete，自身之外只能按 access 读取；只有 Main 能改变 access；普通文件工具不能读取 `.navo/` 绕过 Resource ACL；`send_to_main` 不自动修改 Roadmap、完成 Node 或启动其他 Agent |
| ✅ | F9.6e Main Resource Handoff 与 Node Resource Context | Main Agent 协调 / Node 启动上下文 | Main 通过 Resource 权限服务把资源提供给指定 Node 或提升为 Project 共享；Node 后续 Turn 只发现自己可见的 Resource metadata，需要正文时按 Resource ID 按需读取 | 不新增 Directive 事实源；任务变化继续使用 `modify_roadmap`；Node 上下文只注入 Resource ID / name / description 等元数据，不默认注入完整内容；资源到位不自动启动 Node；当前阶段不实现动态 reload 或 RAG |
| ⬜ | F9.6f Integration 与 Human Gate | F9.6 集成验收 | 用“Node A 产出文件 -> 创建 Resource -> send_to_main -> Main 授权 -> Human start Node B -> Node B fetch Resource”的完整链路验证 | Node B 在授权后保持未执行；Human 启动后才产生 Turn；Node A 无法直接联系或授权 Node B；Resource 内容读取同时受 Project Workspace 与 Resource 权限约束；完整链路不依赖自动 Scheduler |
| ⬜ | F9.7 Human-Controlled ProjectRuntime | Project 执行生命周期 | 让 Project 根据当前 Roadmap、Human 操作和 Main 协调结果判断 Node 是否具备执行条件、是否正在执行以及是否等待人工动作，同时继续复用单一 AgentRuntime | 依赖满足、消息或 Resource 到位都不自动启动 Node；每个 Node Turn 由 Human 明确启动；不新增与 locked/idle/working/completing/skipped 平行的第二套 Node 状态机；同一 Node 无隐式并发 Turn；取消、失败和恢复不产生递归 Agent 调用或悬挂任务 |
| ⬜ | F9.8 长程 Core 集成验收 | 后端集成测试与阶段记录 | 用一个完整 Human-in-the-loop 长程场景证明 Project、Roadmap、Main Agent、多个 Node Agent、资产交接、阻塞协调和 Roadmap Mutation 可以共同工作 | Goal -> Roadmap -> Human start -> Node report / Resource -> Main 协调 -> Human start next Node -> Mutation -> 继续执行的完整链路可重复验证 |
| ⏸️ | F9.9 Public Project / Roadmap Contract Handoff | Host / RPC / 桌面共享控制面 | 在 Core 稳定后，为桌面端提供 Project / Roadmap / Mailbox / Asset 的必要只读状态和 Human 操作入口 | 开始此 Step 前必须停止修改并向用户报告；前后端共同确认版本、人工 Gate、消息 / Resource 引用、取消与兼容语义后才能修改共享契约 |

## 7. Phase 9 关键边界

Phase 9 明确不做：

- 不创建 `MainAgentRuntime`、`NodeAgentRuntime` 或按角色复制 Agent 执行引擎；
- 不让 AgentRuntime 感知 Project、Roadmap、Main/Node 角色或 Research 领域概念；
- 不把 Roadmap 仅保存在 Main Agent Session、Prompt 或一次 LLM 输出里；
- 不允许 Node Agent 直接读取、调用或向另一个 Node Agent 发消息；
- Node 默认不读取完整 Roadmap，也不拥有 `modify_roadmap`；
- 不让依赖满足、收到消息或 Resource 到位自动触发 Node Agent Turn；
- 不让 Node 的 `result` 报告自动改变为人工确认后的终态；
- 不在消息工具调用中递归同步启动 Main 或另一个 Node；
- 不让 LLM 直接提交未经验证的 Roadmap 最终状态；
- 不在 Phase 9 完整实现 Evidence、Verifier、评分器或“任务真的完成”的最终判定；
- F9.6 不加入 RAG、向量检索、动态 Skill / Tool / Resource reload、Claim-Evidence Graph 或长期 Research Memory；
- 不在 F9.9 之前改动 Host / RPC / 前端共享 Project 协议；
- Phase 9 不为 Project / Node / Roadmap / Mailbox / Resource Registry 元数据加入数据库持久化；Project Workspace 从 F9.6b 起承载真实文件，本阶段所说的领域状态恢复仍只指给定历史后的内存重建，不是进程重启恢复；
- F9.6 只借鉴显式 Message / Artifact 的 A2A 思想，不实现标准 A2A 的 Agent Card、网络发现或跨服务 Transport。

## 8. 后续阶段

| Phase | 核心问题 | 目标产物 |
|---|---|---|
| Phase 10（F10） | 应用退出后如何保留并恢复项目与执行上下文？ | Project、Node、Roadmap、Session、Mailbox、Resource Registry 元数据和工具记录的数据库持久化、启动恢复与中断处理；Project Workspace 继续承载实际文件 |
| 后续待排期 | 系统如何判断节点和项目真的完成？ | 保留 Evidence + Verification 目标，在 F10 持久化之后、Research 完整闭环验收之前安排 |
| Phase 11 | Research Workspace 如何使用通用 Core？ | Research Agent Profile、Claim / Evidence、RAG 与研究领域适配 |
| Phase 12 | 系统如何与研究者长期共同演进？ | Research Memory、长期反馈与 Human-AI Co-evolution |

Coding 与 Learning 作为后续 Mode Adapter 验证 Core 通用性，不在 Phase 9 同时恢复为独立产品主线。

## 9. 当前下一步

F9.5 已完成并收口：Main Agent 通过 `read_roadmap`、`read_node`、`write_roadmap`、`modify_roadmap` 建立完整规划闭环，Roadmap / Node version 与可信 Binding 继续作为确定性授权边界；F9.5 收尾见 [70：F9.5 closeout](70-devlog-f9.5-closeout.md)。

F9.6 现重新定义为 **Project Workspace 与 Resource Handoff**。设计见 [71：F9.6 Project Workspace 与 Resource Handoff](71-devlog-f9.6-project-communication-design.md)。核心约束是：Main 是唯一跨 Node 协调者；每个 Project 拥有独立 Workspace；重要产物通过 Resource Registry 获得稳定身份与描述；Node 只看到 Main 为其提供的 Resource metadata，需要时再读取内容；任何消息、Resource 到位和依赖满足都不能自动启动另一个 Node。

F9.6a 已完成：`MailboxStore` 已建立 Project 级 append-only message history，正常写入暴露 `postFromNode` / `postFromMain` 两个方向明确的入口；跨 Project、control Node、非法 replay route 和不连续历史会被拒绝，且 Mailbox 不依赖 AgentRuntime。后续产品链路主要使用 Node -> Main report；不再新增 Directive 作为第二套任务事实源，Main 对 Node 任务的调整继续使用 Roadmap mutation。

F9.6b 已完成：新增独立的 Project Workspace 领域层，在显式可信根目录下按 Project 创建隔离物理空间，并预留 `assets/` 与 `nodes/`；Project-relative ref 使用跨平台相对路径表达，解析时同时拒绝绝对路径、dot/parent segment、反斜杠形式和经真实路径 / symlink 产生的边界逃逸。Project ID 不直接作为目录名，而映射为稳定安全目录键；Workspace 可 create/get/resolve/cleanup。该能力只在 `NavoApp` 收到显式 Workspace root 时挂载，F9.6b 没有修改 Host / RPC / frontend，也没有创建 Resource Registry 或 Agent Tool。实现与验收见 [73：F9.6b Project Workspace Foundation](73-devlog-f9.6b-project-workspace.md)。

F9.6c 已完成代码实现并通过 GitHub Windows CI：新增 Project 级 append-only Resource Registry，Resource 记录稳定 ResourceId、Project、source work Node、title/description/type 与 Project-relative ref；新注册要求目标文件当前存在，历史 replay 则允许内容后来暂时缺失，但仍重新验证 Project / Node / Workspace 边界。跨 Project Resource lookup、control Node 来源、archived Project 新注册、非法历史与重复 Resource id 都被领域层拒绝。实现记录见 [74：F9.6c Project Resource Registry](74-devlog-f9.6c-project-resource-registry.md)。

**F9.6c 已正式收口。** GitHub Windows CI 已通过 `pnpm typecheck` 与全量测试（62 test files / 397 tests），用户随后确认本机 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test` 也全部通过，满足仓库的本机 + CI 双重门禁。随后在进入 Node capability 前完成了一次设计复审：Workspace 改为“用户选择的真实项目目录 + `.navo/` 内部区”，Resource 保持稳定领域对象并由统一服务管理生命周期和权限，而不是扫描目录动态推断。该修订不否定 F9.6b/F9.6c 的历史实现与验收，而是在其基础上通过 F9.6d.1/F9.6d.2 完成迁移。设计记录见 [75：F9.6 Workspace 与 Resource 最终模型修订](75-devlog-f9.6-workspace-resource-revision.md)。**F9.6d.1 已正式收口。** GitHub Windows CI 已通过 `pnpm typecheck` 与全量测试（62 test files / 400 tests），用户随后确认本机 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test` 也全部通过，满足仓库的本机 + CI 双重门禁。Project 现已直接绑定用户真实工作目录，Navo 内部文件统一收口到 `.navo/`，Project-bound 文件读取具备 Workspace containment。实现记录见 [76：F9.6d.1 Project Workspace Root Migration](76-devlog-f9.6d1-workspace-root.md)。**F9.6d.2 已正式收口。** GitHub Windows CI 已通过 `pnpm typecheck` 与全量测试（64 test files / 404 tests），用户随后确认本机完整验证也全部通过。**F9.6d.3 已正式收口。** GitHub Windows CI 已通过 `pnpm typecheck` 与全量测试（67 test files / 414 tests），用户随后确认本机 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test` 也全部通过，满足本机 + CI 双重门禁。Resource owner 已泛化为 `Main | Node`：owner 对自己的 Resource 拥有 register/fetch/update metadata/delete，非 owner 即使通过 `shared/project` 获得访问也只有 Read；Main 额外拥有 access 分发权。正式 Resource 由用户 Workspace 文件复制为 `.navo/assets/<resource-id>/` 下的稳定快照，Project Agent 的普通文件能力禁止进入 `.navo/`，避免绕过 Resource ACL；Node 通过 `send_to_main` 只写 Mailbox，不触发 Agent 或 Roadmap。实现记录见 [78：F9.6d.3 Resource Ownership 与 Main Communication Capability](78-devlog-f9.6d3-resource-capabilities.md)。**F9.6e 已正式收口。** Context Builder 子阶段已完成双重门禁并合入 master；Main Resource Handoff 子阶段随后通过可信 Main Session Binding 接入 `set_resource_access`，支持 `private | shared(nodeIds) | project`，并保持 optimistic revision、同 Project work Node 校验和 Human Gate。GitHub Windows CI 已通过 `pnpm typecheck` 与全量测试（70 test files / 422 tests），用户随后确认本机 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test` 也全部通过。Main handoff 不启动 Node、不修改 Roadmap；新授权 Resource 仍由 Context Builder 在下一次 Human-started Turn 重新 build 时进入 metadata snapshot。实现记录见 [79：F9.6e Node Turn Context Builder](79-devlog-f9.6e-context-builder.md) 与 [80：F9.6e Main Resource Handoff](80-devlog-f9.6e-main-resource-handoff.md)。**

F9.1 与 F9.2 已完成，记录见 [55：Project 与通用 Node 领域](55-devlog-project-node-domain.md)。整个 Phase 9 的 Project / Roadmap / Mailbox / Resource Registry 元数据继续保持内存状态；Project Workspace 从 F9.6b 开始作为实际文件承载层存在。F10 再统一实施项目状态与 Registry 元数据的数据库持久化、启动恢复和中断处理。调研与拆分方案见 [56：内存与持久化阶段划分](56-devlog-persistence-plan.md)。

F9.3.1 的结构规则沿用 [57：路线结构与关系表达](57-devlog-roadmap-graph.md) 并按 [63：F9.3 修复方案](63-devlog-node-state-review.md) 收敛；状态、路线变更、历史重建和地图查询修复见 [64：F9.3 状态模型修复](64-devlog-node-state-repair.md)。F9.4 已建立 Main / Node 的可信 Session Binding 与 Profile 边界；F9.5 已完成 Main Agent Roadmap 规划工具闭环。

Node 当前状态约定：新建 locked，解锁后 idle，实际执行时 working，回合结束回到 idle；人工可将 idle 确认为 completing，或将 locked/idle 确认为 skipped；两种终态均满足后续依赖。RoadmapStore 在同一批 Node 事件中追加 node-unlocked，手动 unlock 不能绕过必选祖先；没有路线的独立 Node 仍可使用 NodeStore 原有生命周期。F9.6 / F9.7 继续遵守 Human Gate：Node 即使具备执行条件，也必须由用户明确启动 Turn。

## 10. 后端维护记录：桌面工具可用性排查（2026-09-14）

- 做了什么：按用户要求排查现有工具注册与桌面模型可见性，修复配置 Exa 后普通桌面回合仅能看到 `web_search` 的问题。修改 `src/host/config.ts`、`tests/host/turn.spec.ts`，新增 `tests/host/tools.spec.ts`。属于既有能力修复，不推进 Phase 9 Step。
- 关键决策：普通桌面回合显式开放 `web_fetch`；配置 Exa 时增加 `web_search`；配置 `NAVO_FILE_CWD` 时增加 `read`、`shell`、`edit`、`write`。保留 Node 专属工具的作用域，不将整个注册表直接暴露给普通会话。复用现有注册与回合链路，不修改前端或 RPC 契约。
- 坑与发现：Search 和 Fetch 默认均已注册，但原 Host 搜索白名单遗漏其他工具；未配置搜索时原先不传白名单，又会暴露缺少 Adapter 的搜索和 Node 专属工具。文件工具注册本身依赖显式工作目录配置。现有配置测试还发现 `boundedInteger` 漏返解析值，一并恢复 `return parsed`。
- 验证：Host 配置与新增工具测试共 13 项通过；四种 Search/File 配置组合检查真实应用注册表，并经过 v2 Handler 与 AgentRuntime 检查 Mock 模型实际收到的 Schema；`pnpm typecheck` 通过。未调用真实搜索/网络服务，未执行文件写入或 Shell，未验收正在运行的桌面实例。
- 下一步：启动桌面应用前按需设置 `NAVO_FILE_CWD` 为已有绝对目录并重启，复验模型工具调用。无新增待落实契约；交付回复提供配置、注册、模型筛选链路的代码导读。该维护记录不推进 Phase 9。

### 系统提示词补充排查

- 桌面 Host 当前系统提示词只有 `You are Navo, a concise and helpful AI agent.`。v1/v2 Handler 均将它传入 Runtime，Session 将其作为首条 system 消息，Qwen Adapter 保留该角色和内容；工具 Schema 独立传输，不由系统提示词决定可用工具集合。
- 内容缺口：没有明确工具执行与结果验证工作流，没有提供已配置文件工作目录，也没有说明搜索与全文获取、Fetch 长文落盘后继续读取之间的配合。工具描述已经提供部分局部规则，不能据此断言模型一定不会调用工具；真实行为仍需模型验收。
- 排查时 Node Profile 仍为 SkillWorld 学习节点身份；已在 F9.2 泛化为通用工作节点，普通桌面入口仍不调用该 Profile。
- 验证：`tests/session/messages.spec.ts` 四项通过，覆盖 system 消息前置且不写入历史 Surface；其余传递链路为源码检查，未进行真实模型实验。

### 文件工具默认启用修复

- 做了什么：修复未设置 NAVO_FILE_CWD 时桌面只暴露 Web 工具的问题。修改 `src/host/config.ts`、`tests/host/file-config.spec.ts`、`tests/host/turn.spec.ts`、`tests/host/tools.spec.ts`；属于既有能力维护，不推进计划 Step。
- 关键决策：Host 默认使用 process.cwd()，显式 NAVO_FILE_CWD 仍覆盖默认且空值继续报错；本地四工具始终加入模型名单，现有 main.ts 创建并校验文件环境后注册工具。Electron 现有启动目录为仓库根目录。工作目录是相对路径基准，不是文件沙箱。
- 坑与发现：此前只修复白名单，仍要求手动提供目录；缺省时注册和模型可见性同时缺失。测试现覆盖有无搜索配置、有无显式目录四种组合，并通过真实 Runtime 执行 read 读取 package.json，断言成功事件和结果回传模型；模型使用 Mock。
- 验证：相关 16 项测试与 pnpm typecheck 通过。未执行 Shell 或写文件，未验收真实模型和正在运行的 Electron。未修改前端、RPC、WebFetch 网络限制或其他进行中的领域改动。
- 下一步：重启 Electron 使 Host 重新读取配置；无新增待落实契约，完成回复交付配置与执行链路导读。