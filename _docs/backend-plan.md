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

Phase 9 的目标不是把 Roadmap 塞进一次 Agent 会话，也不是建立一个以 Scheduler 为中心的工作流引擎，而是让一个 Project 能够长期存在、持续演进，并由一个 Main Agent 管理整体路线、多个相互隔离的 Node Agent 执行节点工作。

## 2. Phase 9 核心产品契约

### Project 是长期生命周期边界

Project 是长程目标的一级对象。Project 的 Goal、Roadmap、Main Agent 上下文、Node 集合和项目进度都应独立于单个 Turn 或单个 Session 长期存在。Session 负责 Agent 连续上下文，不承担 Project 全局事实的唯一存储职责。

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

Main Agent 负责理解 Project Goal、规划与修改 Roadmap、协调 Node、处理阻塞和全局重规划。Node Agent 只负责自己的 Node，不读取其他 Node Agent 的 Session，也不能直接向其他 Node Agent 发消息。

跨节点协作统一经过 Main Agent：

```text
Node A ----X----> Node B

Node A ---> Main Agent ---> Node B
```

Node 的报告、阻塞和协调请求应先成为 Project 可记录事实，再由 Main Agent 后续处理；不在一次工具调用中递归同步触发另一 Agent，以避免隐藏调用链和循环协调。

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

**阶段目标：** 让 Navo 能把一个长期 Goal 作为 Project 持续管理：Main Agent 维护可视化 Roadmap，多个隔离 Node Agent 分别推进节点，Node 的报告和阻塞统一回到 Main Agent 协调，Roadmap 可在执行中安全修改并继续推进。

**阶段验收场景：** 创建 Project 与 Goal；Main Agent 形成多 Node Roadmap；两个独立 Node 可以并行推进；其中一个 Node 报告阻塞但不能直接联系另一个 Node；Main Agent 接收报告后修改 Roadmap 或向相关 Node 下发协调指令；项目依据更新后的 Roadmap 继续执行，最终形成一致、可重放的项目进度状态。

```text
Project
  |
  +--> Goal
  +--> Roadmap Board <-----------------------------+
  |                                                |
  +--> Main Profile + Project Binding + Session    |
  |                  |                             |
  |                  v                             |
  |             AgentRuntime                       |
  |                  |                             |
  |            planning / directives               |
  |                  |                             |
  +--> Node A <------+---- reports ----> Main -----+
  |     Node Profile + Node Binding + Session
  |
  +--> Node B
        Node Profile + Node Binding + Session

Node A --------X--------> Node B
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
| ⬜ | F9.5 Main Agent Planning 与 Roadmap Mutation | Main Agent / Roadmap | 让 Main Agent 能基于 Goal 和项目现状提出 Roadmap 创建或修改方案，并由确定性边界决定方案能否成为新的项目事实 | 插入、跳过、连接调整、重排等变更可验证、可拒绝、可记录；陈旧版本或非法关系不能静默覆盖当前 Roadmap |
| ⬜ | F9.6 Project Mailbox 与协调 | Project 消息与 Node 报告 | 让 Node Agent 可以向 Main Agent 报告完成、阻塞和协调请求，让 Main Agent 可以向指定 Node 下发指令，同时禁止 Node 之间直接通信 | Node 报告先落为可记录事实再被 Main 处理；不存在 Node-to-Node 通道；消息身份和所属 Project 可追溯 |
| ⬜ | F9.7 ProjectRuntime 长期编排 | Project 执行生命周期 | 让 Project 能依据当前 Roadmap 和 Main Agent 决策启动、暂停、继续和收敛多个 Node 执行，并正确处理跨 Node 并行和恢复 | 同一 Node 不发生隐式并发 Turn；独立 Node 可并行；取消、失败和恢复不会产生递归 Agent 调用或悬挂任务 |
| ⬜ | F9.8 长程 Core 集成验收 | 后端集成测试与阶段记录 | 用一个完整长程场景证明 Project、Roadmap、Main Agent、多个 Node Agent、阻塞协调和 Roadmap Mutation 可以共同工作 | Goal -> Roadmap -> 多 Node -> 并行 -> Block -> Main 协调 -> Mutation -> 继续执行的完整链路可重复验证；不以完整 Verification 作为完成条件 |
| ⏸️ | F9.9 Public Project / Roadmap Contract Handoff | Host / RPC / 桌面共享控制面 | 在 Core 稳定后，为桌面端提供只读 Project / Roadmap 状态和必要事件，使 Roadmap 可以成为真实可视化项目看板 | 开始此 Step 前必须停止修改并向用户报告；前后端共同确认版本、校验、取消与兼容语义后才能修改共享契约 |

## 7. Phase 9 关键边界

Phase 9 明确不做：

- 不创建 `MainAgentRuntime`、`NodeAgentRuntime` 或按角色复制 Agent 执行引擎；
- 不让 AgentRuntime 感知 Project、Roadmap、Main/Node 角色或 Research 领域概念；
- 不把 Roadmap 仅保存在 Main Agent Session、Prompt 或一次 LLM 输出里；
- 不允许 Node Agent 直接读取、调用或向另一个 Node Agent 发消息；
- 不把整个 Roadmap 强制建模成严格 DAG；
- 不让 LLM 直接提交未经验证的 Roadmap 最终状态；
- 不在 Phase 9 完整实现 Evidence、Verifier、评分器或“任务真的完成”的最终判定；
- 不加入 Research 专属 RAG、Claim-Evidence Graph、论文库、LaTeX 或长期 Research Memory；
- 不在 F9.9 之前改动 Host / RPC / 前端共享 Project 协议；
- Phase 9 不加入数据库或自动落盘；本阶段所说的恢复只指给定历史后的内存重建，不是进程重启恢复。

## 8. 后续阶段

| Phase | 核心问题 | 目标产物 |
|---|---|---|
| Phase 10（F10） | 应用退出后如何保留并恢复项目与执行上下文？ | Project、Node、Roadmap、Session、消息和工具记录的数据库持久化、启动恢复与中断处理 |
| 后续待排期 | 系统如何判断节点和项目真的完成？ | 保留 Evidence + Verification 目标，在 F10 持久化之后、Research 完整闭环验收之前安排 |
| Phase 11 | Research Workspace 如何使用通用 Core？ | Research Agent Profile、Claim / Evidence、RAG 与研究领域适配 |
| Phase 12 | 系统如何与研究者长期共同演进？ | Research Memory、长期反馈与 Human-AI Co-evolution |

Coding 与 Learning 作为后续 Mode Adapter 验证 Core 通用性，不在 Phase 9 同时恢复为独立产品主线。

## 9. 当前下一步

F9.4 的实现已在 `phase9-f9.4-agent-binding` 分支完成：Main / Node Profile 与 Session 均继续复用唯一 AgentRuntime；可信 Binding 从 ProjectStore / NodeStore 的 Session 所有权动态派生，并在角色入口和工具授权边界校验。实现与测试设计记录见 [65：F9.4 Agent Profile 与 Binding](65-devlog-agent-profile-binding.md)。

本机开发环境已补跑完整验证：`pnpm typecheck` 通过，`pnpm test` 全量 54 个测试文件、359 项测试通过，F9.4 定向测试 5 个文件、22 项测试通过，因此 F9.4 标记为 ✅。**下一步是 F9.5 Main Agent Planning 与 Roadmap Mutation。**循环步骤已取消，数据库持久化仍放到 F10。

F9.1 与 F9.2 已完成，记录见 [55：Project 与通用 Node 领域](55-devlog-project-node-domain.md)。整个 Phase 9 先使用内存状态；原临时数据库子步骤已撤销，F9.3 已按节点状态、路线与解锁、地图查询三个子步骤完成。F10 统一实施项目、节点、路线图、会话、消息及工具记录的数据库持久化与启动恢复。原 F10 Evidence/Verification 目标保留，待持久化之后重新排期。调研与拆分方案见 [56：内存与持久化阶段划分](56-devlog-persistence-plan.md)。

F9.3.1 的结构规则沿用 [57：路线结构与关系表达](57-devlog-roadmap-graph.md) 并按 [63：F9.3 修复方案](63-devlog-node-state-review.md) 收敛；状态、路线变更、历史重建和地图查询修复见 [64：F9.3 状态模型修复](64-devlog-node-state-repair.md)。F9.4 已建立 Main / Node 的可信 Session Binding 与 Profile 边界；Main Agent 的 Roadmap 创建/修改工具仍由 F9.5 实现，前端仍需在 F9.9 串行接入只读契约。

Node 当前状态约定：新建 locked，解锁后 idle，实际执行时 working，回合结束回到 idle；人工可将 idle 确认为 completing，或将 locked/idle 确认为 skipped；两种终态均满足后续依赖。RoadmapStore 在同一批 Node 事件中追加 node-unlocked，手动 unlock 不能绕过必选祖先；没有路线的独立 Node 仍可使用 NodeStore 原有生命周期。人工确认 UI/RPC 尚未接入；Main / Node 身份与资源作用域已由 F9.4 建立，Roadmap 管理授权将在 F9.5 的实际工具边界继续消费该 Binding。
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

- 做了什么：修复未设置 NAVO_FILE_CWD 时桌面只暴露 Web 工具的问题。修改 src/host/config.ts、tests/host/file-config.spec.ts、tests/host/turn.spec.ts、tests/host/tools.spec.ts；属于既有能力维护，不推进计划 Step。
- 关键决策：Host 默认使用 process.cwd()，显式 NAVO_FILE_CWD 仍覆盖默认且空值继续报错；本地四工具始终加入模型名单，现有 main.ts 创建并校验文件环境后注册工具。Electron 现有启动目录为仓库根目录。工作目录是相对路径基准，不是文件沙箱。
- 坑与发现：此前只修复白名单，仍要求手动提供目录；缺省时注册和模型可见性同时缺失。测试现覆盖有无搜索配置、有无显式目录四种组合，并通过真实 Runtime 执行 read 读取 package.json，断言成功事件和结果回传模型；模型使用 Mock。
- 验证：相关 16 项测试与 pnpm typecheck 通过。未执行 Shell 或写文件，未验收真实模型和正在运行的 Electron。未修改前端、RPC、WebFetch 网络限制或其他进行中的领域改动。
- 下一步：重启 Electron 使 Host 重新读取配置；无新增待落实契约，完成回复交付配置与执行链路导读。