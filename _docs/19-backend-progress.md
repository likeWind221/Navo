# 后端开发进度总览

**规划基线：** `master@7b4e1f3`  
**当前设计分支：** `phase9-project-runtime`  
**更新原则：** 本文只记录当前可运行能力、已确认的架构方向和下一步，不替代逐阶段开发记录。

## 1. 当前结论

Phase 0–8 后端基础已经完成，当前后端路线正式进入 **Phase 9：Project-Oriented Multi-Agent Roadmap Runtime**。

这次路线调整明确了一个关键产品边界：Navo 不是在一次 Agent 会话内部隐藏执行一串 Task，而是长期管理一个 Project。Project 拥有持续存在的 Roadmap；一个 Main Agent 负责全局规划和跨节点协调；每个 Roadmap Node 由隔离的 Node Agent 推进。Main / Node 共用现有 `AgentRuntime`，角色差异来自 Profile、可信 Binding 和各自 Session，而不是两套 Runtime。

```text
Project
  |
  +--> Goal
  +--> Persistent Roadmap Board
  +--> Main Profile + Project Binding + Main Session
  |                         |
  |                         v
  |                    AgentRuntime
  |
  +--> Node A: Node Profile + Node Binding + Node Session
  +--> Node B: Node Profile + Node Binding + Node Session

Node A ----X----> Node B
Node A ---> Main Agent ---> Node B
```

Roadmap 是项目权威进度状态和未来可视化看板的数据来源，不再被理解为 Main Agent 某次对话中的临时计划；Scheduler 也不再作为 Phase 9 的一级产品模块，节点是否满足依赖属于 Roadmap 状态的确定性派生能力。

## 2. 已完成后端基础

| Phase | 状态 | 当前可复用能力 | 主要入口 |
|---|---|---|---|
| 0 | ✅ | TypeScript、Node、pnpm、Cordis 工程骨架 | `package.json`、`tsconfig.json` |
| 1 | ✅ | 品牌 ID、LLM 消息与工具协议 | `src/brand`、`src/llm` |
| 2 | ✅ | SessionEvent、追加日志、消息投影与 Surface | `src/session` |
| 3 | ✅ | 流式 LLM、ToolService、Schema、错误与取消 | `src/llm`、`src/tools` |
| 4 | ✅ | 单一通用 `AgentRuntime`、Turn 生命周期、同 Session 串行 | `src/agent` |
| 5 | ✅ | 应用组合与模型 -> 工具 -> 模型闭环 | `src/app.ts`、集成测试 |
| 6 | ✅ | NodeEvent / NodeStore、Node–Session 一对一、NodeAgent Profile、隔离与并行 | `src/node` |
| 7 | ✅ | `web_search` / `web_fetch` 调研链路与安全网络边界 | `src/tools/builtins/{search,fetch}` |
| 8 | ✅ | `read`、`shell`、`edit`、`write`、Fetch spill、文件版本与并发安全 | `src/tools/builtins/{file,shell}` |

桌面链路另外已经具备 Kernel Host、真实模型 Adapter、Agent 回合/思考/工具事件、会话命令和 Stream RPC。Phase 9 的 Project / Roadmap 公共契约尚未接入这些桌面边界。

## 3. 当前 Node 资产评估

现有 `src/node` 虽然仍带有 SkillWorld 的 capability、教材和练习题语义，但它已经验证了一批 Phase 9 需要继续保留的机制：

- 每个 Node 有独立 `NodeId` 与追加式 `NodeEvent`；
- `projectNode()` 可以从完整事件历史严格重建当前快照；
- Node 与 Session 一对一绑定，Session 不能同时属于多个 Node；
- 同 Node 的消息 FIFO 执行，不同 Node 可以并行；
- NodeAgent 每 Turn 从最新 Node 快照生成 Profile，再复用通用 `AgentRuntime`；
- 工具通过运行时 Session 身份反查 Node，模型不能任意指定写入其他 Node；
- 现有 Profile 已明确禁止 Node 修改 Road Map 或访问其他 NodeSession，并要求把前置缺口作为 Main Agent proposal。

因此 Phase 9 不新建平行的 `Task` 执行体系。后续会把现有 Node 从 Learning 专属内容模型演进成 Generic Project Node，同时保留已经验证的事件流、Session 隔离、FIFO 和授权模式。

## 4. Phase 9 已确认架构

### 单一 AgentRuntime

`AgentRuntime` 继续只负责一个 Agent Turn 的通用模型 -> 工具 -> 模型循环，不理解 Project、Roadmap、Main Agent 或 Node Agent。

```text
Main Agent
= AgentRuntime + Main Profile + Project Binding + Main Session

Node Agent
= AgentRuntime + Node Profile + Node Binding + Node Session
```

Profile 决定模型角色和可见工具，Binding 与 Store / Tool 授权决定实际资源范围。后端不会把“不要访问其他 Node”仅写成 Prompt 软约束。

### ProjectRuntime

Phase 9 后续会新增 Project 级可信编排边界，用于承接长期 Project 生命周期、Roadmap 事实、Node 激活/暂停/恢复、Main 与 Node 消息路由和跨 Node 并发。ProjectRuntime 不负责“思考项目应该怎么做”；全局决策归 Main Agent，ProjectRuntime 只可靠执行和校验被允许的操作。

### Project Mailbox

Node Agent 不直接调用其他 Node Agent。Node 的完成、阻塞、信息缺口和协调请求先写成 Project 可记录事实，然后由 Main Agent 在后续 Turn 中消费。Main Agent 可以再向指定 Node 下发指令或修改 Roadmap。

这种异步边界避免 `Node -> Main -> Node -> Main` 在一次工具调用中形成隐藏递归链。

## 5. Phase 9 当前状态

| Step | 状态 | 当前结论 |
|---|---|---|
| F9.0 架构与边界收口 | ✅ | Project / Roadmap / Main / Node / 单一 AgentRuntime 的产品边界已确认，Phase 9 路线已重写 |
| F9.1 Project Domain | ⬜ | 下一步 |
| F9.2 Generic Project Node | ⬜ | 复用并泛化现有 `src/node`，不另起 Task 系统 |
| F9.3 Persistent Roadmap Board | ⬜ | Roadmap 成为长期项目权威状态和可视化投影来源 |
| F9.4 Agent Profile 与 Binding | ⬜ | Main / Node 共用 AgentRuntime，权限由可信绑定重复校验 |
| F9.5 Main Agent Planning / Mutation | ⬜ | LLM 决策与确定性 Roadmap 提交边界分离 |
| F9.6 Project Mailbox | ⬜ | Node -> Main、Main -> Node；禁止 Node -> Node |
| F9.7 ProjectRuntime 长期编排 | ⬜ | 多 Node 生命周期、并行、暂停、恢复与收敛 |
| F9.8 长程 Core 集成验收 | ⬜ | 完成长程 Project 主闭环 |
| F9.9 Public Project / Roadmap Contract | ⏸️ | Core 稳定后再做；进入前必须先进行前后端公共契约交接 |

详细功能目标以 `_docs/backend-plan.md` 为后端单一事实源；架构取舍见 Phase 9 设计记录。

## 6. 已验证能力与实际边界

当前代码已经验证的是 Phase 0–8 基础，不应把 Phase 9 设计误认为已实现：

- `AgentRuntime` 已能在同 Session 内串行执行 Turn，不同 Session 可以并发；
- Node 与 NodeSession 已具备一对一绑定、隔离和独立 FIFO；
- Search / Fetch / 文件工具可作为未来 Node Profile 的执行能力；
- SessionEvent 与 NodeEvent 已分别记录执行事实和旧 Node 领域事实；
- Host / RPC 已能传输 Agent 回合与工具过程，但还不知道 Project / Roadmap。

尚未实现：Project 身份与生命周期、通用 Project Node、Roadmap Store / Board Projection、Main Profile、Project Binding、Project Mailbox、Roadmap Mutation Gate、ProjectRuntime 以及 Project / Roadmap 公共 RPC。

## 7. 验收证据

最近一次 Phase 8 收口记录显示：在 Node v24.14.0、pnpm 10.33.0 环境下完成依赖安装、类型检查、构建和完整测试，47 个测试文件共 324 项测试通过；文件工具装配、Fetch spill、版本保护、并发创建和取消链路均已验收。

本次 Phase 9 架构提交是**纯文档调整**，没有修改生产代码，也没有重新运行上述工程测试；这里保留的是既有 Phase 8 的历史验收事实，而不是本次提交的新测试结果。

## 8. 后续路线

- **Phase 9：** Project-Oriented Multi-Agent Roadmap Runtime；
- **Phase 10：** Evidence + Verification，将“执行完成”与“可信通过”分离；
- **Phase 11：** Research Workspace 领域适配，包括 Research Profile、Claim / Evidence 与 RAG；
- **Phase 12：** Research Memory 与 Human-AI Co-evolution。

Research、Coding、Learning 不进入 AgentRuntime Core；它们后续通过 Profile / Mode Adapter 使用相同 Project 与 Agent 执行基础。

## 9. 当前下一步

**F9.1 Project Domain。**

先建立长期 Project 的身份、Goal、主执行上下文与生命周期，并明确 Project 与 Session 的归属关系。该 Step 不提前实现 Roadmap、Node 泛化、Mailbox、Main Agent 规划或跨端协议；进入具体代码前按项目约定先给出 F9.1 Step 说明并确认。
