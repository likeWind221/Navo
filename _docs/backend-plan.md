# Navo 后端与 Agent Core 开发计划

> 当前产品定义以 `_docs/00-navo-prd.md` 为准。Phase 0–8 保留为已完成的通用执行基础；自 Phase 9 起，后端主线转向面向长期 Project 的 Roadmap、Main Agent 协调与隔离 Node Agent 执行。

## 1. 当前范围

Phase 0–8 已完成 Session / Event、LLM、ToolService、AgentRuntime、Search / Fetch、文件工具、Node 原型、Kernel Host 与桌面 Agent 链路等基础能力。Phase 9 不重写这些执行基础，而是在其上建立长期 Project 级编排。

当前阶段：

```text
Project Goal
    |
    v
Persistent Roadmap Board
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

Roadmap 不整体限制为严格 DAG。Core 需要表达硬依赖、软顺序、并行、可跳过、可替换和动态插入等语义。当前是否可推进某 Node 是 Roadmap 状态的确定性派生结果，不单独把 Scheduler 提升为产品架构中心。

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
- 严格执行“一个 Step -> 人工审查 -> 确认后继续”。未经确认，不提前实现后续 Step。
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
| ⬜ | F9.1 Project Domain | Project 领域 | 让系统拥有独立于单次会话的长期 Project 身份、Goal、主执行上下文和生命周期 | 可以创建、读取和重建一个 Project；Project 与 Session / Node 身份不会混用；不要求此时产生 Roadmap |
| ⬜ | F9.2 Generic Project Node | Node 领域 | 把现有学习 Node 演进为通用项目工作单元，同时保留节点独立上下文、持续 Session、同节点串行和跨节点隔离 | Node 不再依赖教材/练习等 Learning Core 语义；每个 Node 仍只能操作自己的作用域；既有隔离不回归 |
| ⬜ | F9.3 Persistent Roadmap Board | Roadmap 领域 | 让 Project 拥有长期 Roadmap，记录 Node 关系、项目进度、版本与修改历史，并能稳定投影为看板/地图所需状态 | 同一历史可重建同一 Roadmap；硬依赖、软顺序、并行、跳过、替换和动态插入具有明确语义；可执行性从当前事实确定性派生 |
| ⬜ | F9.4 Agent Profile 与 Binding | Project / Node Agent 角色边界 | 让 Main Agent 与 Node Agent 在同一 AgentRuntime 上获得不同角色、上下文和能力，同时由可信作用域约束实际可访问资源 | Main / Node 不新增独立 Runtime；Profile 不是唯一安全边界；Node 无法通过伪造输入访问其他 Node 或 Project 管理能力 |
| ⬜ | F9.5 Main Agent Planning 与 Roadmap Mutation | Main Agent / Roadmap | 让 Main Agent 能基于 Goal 和项目现状提出 Roadmap 创建或修改方案，并由确定性边界决定方案能否成为新的项目事实 | 插入、跳过、替换、重排等变更可验证、可拒绝、可记录；陈旧版本或非法关系不能静默覆盖当前 Roadmap |
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
- 不在 F9.9 之前改动 Host / RPC / 前端共享 Project 协议。

## 8. 后续阶段

| Phase | 核心问题 | 目标产物 |
|---|---|---|
| Phase 10 | 系统如何判断节点和项目真的完成？ | Evidence + Verification，作为独立可信验证边界接回 Project Runtime |
| Phase 11 | Research Workspace 如何使用通用 Core？ | Research Agent Profile、Claim / Evidence、RAG 与研究领域适配 |
| Phase 12 | 系统如何与研究者长期共同演进？ | Research Memory、长期反馈与 Human-AI Co-evolution |

Coding 与 Learning 作为后续 Mode Adapter 验证 Core 通用性，不在 Phase 9 同时恢复为独立产品主线。

## 9. 当前下一步

**下一步：F9.1 Project Domain。**

该 Step 只解决“长期 Project 是什么、如何拥有稳定身份与 Goal、如何与 Main Session 建立可信归属、如何重建项目生命周期”这一层问题；不提前实现 Roadmap、Main Agent 规划、Node 泛化、Mailbox 或跨端协议。进入 F9.1 时先按项目约定给出 Step 说明，并在用户确认后开始代码实现。
