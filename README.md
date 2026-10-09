# Navo

[中文](#中文) | [English](#english)

## 中文

### Navo 是什么

Navo 是一个从 0 手写的长程任务 Agent 编排框架。用户给出一个 Goal，系统把它拆成可编辑的 Roadmap（有向无环的节点图）；一个 Main Agent 负责规划与协调，多个相互隔离的 Node Agent 各自负责一个节点；节点之间的产物以带访问控制的 Resource 交接；每一个 Agent Turn 都由 Human 启动，节点完成也由 Human 最终确认。

PRD 定义的核心循环：

```text
Goal
  |
  v
Adaptive Roadmap  <---------------------------+
  |                                            |
  v                                            |
Task / Agent / Tool Scheduling                 |
  |                                            |
  v                                            |
Execution                                      |
  |                                            |
  v                                            |
Verification --(fail)--> Replanning / Roadmap Mutation
  |
  (pass) --> Next Task
```

`master` 目前实现的是 Phase 9 的 Core：Roadmap、Node 状态、Main / Node Agent、Mailbox、Resource 交接和 Human 控制的 ProjectRuntime。自动 Verification 与数据库持久化属于后续阶段。

### 架构

```text
                         Human
                           |
                           v
+--------------------------------------------------------------+
| ProjectRuntime   startMain / startNode / continueNode /      |
|                  cancel / confirmCompletion / skip           |
+--------------------------------------------------------------+
          |                                   |
          v                                   v
+----------------------------+    +----------------------------+
| Main Agent                 |    | Node Agent  x N            |
| = AgentRuntime             |    | = AgentRuntime             |
|   + Main Profile           |    |   + Node Profile           |
|   + Project Binding        |    |   + Node Binding           |
|   + Main Session           |    |   + own Session            |
| tools: read_roadmap        |    | tools: file tools          |
|   create_roadmap            |    |   web search / fetch       |
|   modify_roadmap           |    |   register_resource        |
|   read_node read_mailbox   |    |   fetch_resource           |
|   set_resource_access      |    |   update/delete_resource   |
|   + resource & web tools   |    |   send_to_main             |
+----------------------------+    +----------------------------+
      ^        |                         |          |
      |        |      Project Mailbox    |          |
      +--------|------ (Node -> Main) ---+          |
               v                                    v
+------------------+  +--------------------+  +------------------+
| RoadmapStore     |  | ResourceService    |  | NodeStore        |
| event-sourced    |  | stable ResourceId  |  | 5 states         |
| DAG + version    |  | owner / revision   |  |                  |
| unlock when deps |  | access: private |  |  |                  |
| are met          |  | shared(nodes) |    |  |                  |
|                  |  | project            |  |                  |
+------------------+  +--------------------+  +------------------+
                              |
                              v
                Project Workspace (user files + .navo/)

All agents share one AgentRuntime -> LLMService -> ToolService
```

| 模块 | 位置 | 职责 |
| --- | --- | --- |
| AgentRuntime | `src/agent/` | 单 Agent 的 Turn 循环：组装请求、流式解析模型输出、调度工具、回填结果 |
| Roadmap | `src/roadmap/` | 以事件记录 Roadmap，`projectRoadmap` 重放得到当前 DAG；`base_version` 过期的修改被拒绝；拒绝环、悬空依赖与重复节点；依赖满足时解锁下游 |
| Node | `src/node/` | 五种节点状态；模型不能自行宣布完成，Human 针对指定 revision 确认 |
| Main / Node Agent | `src/project/` | 同一个 AgentRuntime，靠 Profile 与可信 Binding 区分角色；Node 看不到也改不了 Roadmap，Node 之间不能直接通信 |
| ProjectRuntime | `src/project/runtime.ts` | 所有 Agent Turn 的唯一入口；没有任何事件会自动唤醒 Agent；每个 Main / Node 同时只有一个活跃 Turn |
| Mailbox | `src/mailbox/` | 只允许 Node -> Main；Main -> Node 通过 Resource 共享与 Human 启动的 Turn 完成 |
| Resource ACL | `src/resource/` | owner 来自 Binding；只有 Main 能修改访问权限；文件工具无法读取 `.navo/` |
| LLM / Tools | `src/llm/`、`src/tools/` | 模型适配（含 Mock 与 Qwen）与工具注册、策略、执行 |
| 桌面端 | `frontend/`、RPC | Electron + React，经 stdio NDJSON RPC 连接后端；已接入项目创建、列表与详情（F5.2）；项目内 Main 对话与 Roadmap 视图尚未接入 |

### 运行

需要 Node.js >= 24 与 pnpm 10（在 Node 22 上有 5 个 shell / host 进程相关测试失败）。

```bash
pnpm install
```

```bash
pnpm demo
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

接入真实模型（OpenAI 兼容接口；注意 `LLM_BASE_URL` 的默认值是作者局域网内的服务器，必须显式设置）：

```bash
LLM_API_KEY=... LLM_MODEL=... LLM_BASE_URL=... pnpm host
```

```bash
LLM_API_KEY=... LLM_MODEL=... LLM_BASE_URL=... pnpm exec tsx scripts/longterm.ts
```

桌面端：

```bash
cd frontend && pnpm install && pnpm dev
```

### 离线演示

`pnpm demo` 不需要 API Key，也不访问网络：它用脚本化的 Mock 模型驱动真实的 ProjectRuntime、RoadmapStore、ResourceService 与 Mailbox，完成一个长程任务。目标是：在 A、B 两个候选中做推荐，要求延迟低于 150 ms、准确率不低于 93%。

| 步骤 | Human 操作 | 系统行为 |
| --- | --- | --- |
| [1] | 启动 Main Turn | Main 规划 `evidence -> synthesis`，Roadmap v1 |
| [2] | 尝试提前启动 synthesis | 被 Gate 拒绝：节点仍为 locked |
| [3] | 启动 evidence | Node 发布私有 Resource，并 `send_to_main` 汇报 |
| [4] | 确认 evidence 完成 | synthesis 变为 idle，但不会自动运行 |
| [5] | 启动 Main Turn | Main 读 Mailbox，把 Resource 只共享给 synthesis |
| [6] | 启动 synthesis | 读取证据；试图 `modify_roadmap` 被拒绝；上报 BLOCKER |
| [7] | 启动 Main Turn | Main 插入 validation（v2）；过期版本的 connect 被拒；重读后连接（v3），synthesis 重新 locked |
| [8] | 尝试继续 synthesis | 被 Gate 拒绝 |
| [9]–[11] | 启动 validation、启动 Main、确认 validation | 发布验证 Resource，Main 共享给 synthesis，Human 确认 |
| [12] | 继续 synthesis（同一 Session） | 读取验证结果，推荐 Candidate A |
| [13] | 确认 synthesis | 所有节点进入 completing |

第 [7] 步的真实输出节选：

```text
[7] Human: start a Main Agent turn (handle the blocker and replan)
    call   read_mailbox {}
    call   read_roadmap {}
    call   modify_roadmap {"base_version":1,"action":"add_node","reason":"Resolve synthesis b...
    result Roadmap updated successfully. Created Node mapping: - validation -> 50ceb549-32cc-48d3-...
    call   modify_roadmap {"base_version":1,"action":"connect","from_node_id":"50ceb549-32cc-...
    REJECT Error: The Roadmap changed since the version you read. Call read_roadmap again and retr...
    call   read_roadmap {}
    call   modify_roadmap {"base_version":2,"action":"connect","from_node_id":"50ceb549-32cc-...
    result Roadmap updated successfully. Roadmap version: 3 Dependencies: 5c29627b-baef-440b-b5bc-...
    says   "Roadmap v3: synthesis now also waits for validation."
    state  roadmap=v3 evidence=completing synthesis=locked validation=idle

Done: 8 agent turns, 28 model steps, 13 human actions, roadmap v3.
Guardrails exercised: forbidden-replan, stale-connect
```

相关代码：[scripts/demo.ts](scripts/demo.ts)、[scripts/demo/script.ts](scripts/demo/script.ts)、[tests/integration/demo.spec.ts](tests/integration/demo.spec.ts)（保证演示持续可运行）、[tests/integration/longterm.spec.ts](tests/integration/longterm.spec.ts)。

### 当前边界

- 所有状态只在内存中，持久化属于 Phase 10。
- 节点完成由 Human 确认，尚无自动 Evidence / Verification；Replanning 由 Main 在 Human 启动的 Turn 中完成。
- 同一场景的真实模型验收仍在进行中，见 [_docs/bug-plan.md](_docs/bug-plan.md)。
- 桌面端可创建、列出和打开项目（项目公共接口 F9.9 已交付）；项目内 Main 对话与 Roadmap 视图尚未接入。

### 文档

- [PRD](_docs/00-navo-prd.md)
- [后端计划](_docs/backend-plan.md)
- [前端计划](_docs/frontend-plan.md)
- [Bug 跟踪](_docs/bug-plan.md)
- [文档索引](_docs/index.md)

## English

### What Navo is

Navo is a long-horizon agent orchestration framework written from scratch. A Goal becomes an editable Roadmap (a DAG of nodes). One Main Agent plans and coordinates; isolated Node Agents each own a single node; artifacts are handed over as access-controlled Resources; every agent turn is started by a Human, and every node completion is confirmed by a Human.

The core loop from the PRD is shown in the diagram above (Goal -> Adaptive Roadmap -> scheduling -> Execution -> Verification, with Replanning / Roadmap Mutation feeding back). `master` implements the Phase 9 core; automatic Verification and database persistence are later phases.

### Architecture

See the architecture diagram above.

| Module | Location | Responsibility |
| --- | --- | --- |
| AgentRuntime | `src/agent/` | Single-agent turn loop: build the request, parse streamed model output, run tools, feed results back |
| Roadmap | `src/roadmap/` | Event-recorded roadmap replayed by `projectRoadmap`; edits against a stale `base_version` are rejected; cycles, dangling and duplicate nodes are rejected; downstream nodes unlock when dependencies are met |
| Node | `src/node/` | Five node states; the model cannot mark itself complete, a Human confirms against a specific revision |
| Main / Node Agents | `src/project/` | One AgentRuntime, roles set by Profile and a trusted Binding; Nodes cannot see or modify the roadmap or talk to each other |
| ProjectRuntime | `src/project/runtime.ts` | The only entry for agent turns; nothing auto-wakes an agent; at most one active turn per Main / Node |
| Mailbox | `src/mailbox/` | Node -> Main only; Main reaches Nodes through Resource sharing and Human-started turns |
| Resource ACL | `src/resource/` | Owner comes from the Binding; only Main changes access; file tools cannot read `.navo/` |
| LLM / Tools | `src/llm/`, `src/tools/` | Model adapters (Mock, Qwen) and tool registry, policy and execution |
| Desktop | `frontend/`, RPC | Electron + React over stdio NDJSON RPC; project create / list / detail wired (F5.2); in-project Main chat and Roadmap views not wired yet |

### Running

Requires Node.js >= 24 and pnpm 10 (on Node 22, 5 shell / host-process tests fail). Commands: `pnpm install`, `pnpm demo`, `pnpm typecheck`, `pnpm test`.

For a real model (OpenAI-compatible endpoint), set `LLM_API_KEY`, `LLM_MODEL` and `LLM_BASE_URL` and run `pnpm host` or `pnpm exec tsx scripts/longterm.ts`. The default `LLM_BASE_URL` points at the author's LAN server, so set it explicitly. Desktop: `cd frontend && pnpm install && pnpm dev`.

### Offline demo

`pnpm demo` needs no API key and no network. A scripted Mock model drives the real ProjectRuntime, RoadmapStore, ResourceService and Mailbox through one long-horizon task: recommend candidate A or B with latency below 150 ms and accuracy at least 93%.

1. Main plans `evidence -> synthesis` (roadmap v1); an early start of synthesis is refused by the gate.
2. The evidence Node publishes a private Resource and reports to Main; the Human confirms it, and synthesis becomes idle without running on its own.
3. Main shares the Resource with synthesis only. Synthesis reads it, its attempt to call `modify_roadmap` is rejected, and it reports a BLOCKER.
4. Main inserts a validation node (v2); a connect against the stale version is rejected; it re-reads and connects (v3), so synthesis is locked again and a continue attempt is refused.
5. Validation publishes its result, Main shares it, and the Human confirms validation.
6. Synthesis continues in the same session, recommends Candidate A, and the Human confirms it: 8 agent turns, 13 human actions, roadmap v3.

See [scripts/demo.ts](scripts/demo.ts), [scripts/demo/script.ts](scripts/demo/script.ts), [tests/integration/demo.spec.ts](tests/integration/demo.spec.ts) and [tests/integration/longterm.spec.ts](tests/integration/longterm.spec.ts).

### Current limits

- State is in memory only; persistence is Phase 10.
- Completion is Human-confirmed; there is no automatic Evidence / Verification yet, and replanning happens in Human-started Main turns.
- Real-model acceptance of the same scenario is still in progress; see [_docs/bug-plan.md](_docs/bug-plan.md).
- The desktop app can create, list and open projects (project public API delivered in F9.9); in-project Main chat and Roadmap views are not wired yet.

### Docs

[PRD](_docs/00-navo-prd.md) · [Backend plan](_docs/backend-plan.md) · [Frontend plan](_docs/frontend-plan.md) · [Bug tracker](_docs/bug-plan.md) · [Doc index](_docs/index.md)
