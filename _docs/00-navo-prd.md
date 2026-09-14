# Navo PRD：自适应长程 Agent 框架

**版本：** v1.0（品牌与方向迁移）  
**日期：** 2026-09-14  
**定位：** Navo 是一个面向长程任务的自适应 Agent 框架。系统核心不绑定具体应用域，Research Workspace 是当前首个重点应用。

---

## 1. 一句话描述

给定一个长程目标，Navo 将其组织为可执行、可动态修改的 Adaptive Roadmap，调度 Agent 与工具完成任务，并依据可检查的结果进行 Verification；当执行失败、证据不足或环境变化时，系统通过 Replanning 修改后续路线，而不是把计划视为一次性静态输出。

## 2. 核心循环

```text
Goal
  ↓
Adaptive Roadmap
  ↓
Task / Agent / Tool Scheduling
  ↓
Execution
  ↓
Verification
  ├─ Pass → Next Task
  └─ Fail → Replanning / Roadmap Mutation
                    ↓
              Continue Execution
```

核心原则：

1. **Roadmap 是活的执行计划**：规划结果允许在执行中插入、跳过、替换、重排节点。
2. **规划、执行与验证分离**：执行结果不能由执行者自行宣布为完成。
3. **证据驱动完成**：关键结论和任务完成状态需要可检查的 Artifact / Evidence 支撑。
4. **Replanning 是一等能力**：失败、信息不足和目标变化都可以触发局部或全局重规划。
5. **执行轨迹可追溯**：Roadmap 变化、任务执行、验证结果和关键产物应能被记录和重放。
6. **核心与应用域分离**：Research、Coding、Learning 等模式通过领域适配层使用同一套 Core，不把领域语义写进通用 Runtime。

## 3. Adaptive Roadmap

Navo 不把整个规划模型限定为严格 DAG。Roadmap 可以包含多种关系和执行语义：

```text
Hard dependency     A → B
Soft order          A ⇢ B
Parallel            A ─┬→ B
                       └→ C
Skippable           A ─────→ C
Replaceable         B → B'
Dynamic insertion   A → X → B
```

具体数据结构由 Phase 9 设计确定，但 Core 需要能够表达：

- 强依赖与弱依赖；
- 推荐顺序与可并行任务；
- 可跳过、可替换和动态插入任务；
- Roadmap 版本与修改原因；
- 当前可执行任务集合；
- 用户确认点与自动执行边界。

## 4. 核心架构

```text
Navo Core
├─ Agent Runtime
├─ Tool Runtime
├─ Session / Event Record
├─ Adaptive Roadmap
├─ Scheduler
├─ Verification
├─ Memory
└─ Mode Adapter
    └─ Research Workspace   ← 当前重点
```

现有 Phase 0–8 已完成的 Session、LLM、Tool、Agent Runtime、RPC、Electron、Search / Fetch 与文件工具继续作为 Navo 的通用执行基础。Navo 品牌迁移不改变这些通用模块的职责名称。

## 5. Research Workspace

Research 是 Navo 当前优先验证的垂直应用，但不是 Core 的唯一目标域。

```text
Research Goal
      ↓
Adaptive Research Roadmap
      ↓
Literature / Code / Data Execution
      ↓
Evidence
      ↓
Claim-Evidence Graph
      ↓
Verification
      ↓
Research Artifact
      ↓
Replanning
```

Research Workspace 后续可包含：

- 文献检索与论文库；
- Claim-Evidence Graph；
- 代码实验与数据分析；
- RAG / Domain Knowledge；
- Research Memory；
- LaTeX Editor 与 PDF Preview；
- 人机共同干预 Roadmap 的工作区。

这些属于 Research 领域能力，不应反向污染 Navo Core 的通用抽象。

## 6. 近期阶段

| Phase | 核心问题 | 目标产物 |
|---|---|---|
| Phase 9 | Agent 如何可靠执行长程任务？ | Adaptive Roadmap Runtime |
| Phase 10 | 系统如何知道任务真的完成？ | Evidence + Verification |
| Phase 11 | Research 如何形成可用闭环？ | Research Agent + Claim/Evidence + RAG |
| Phase 12 | 系统如何与研究者长期共同改进？ | Research Memory + Human-AI Co-evolution |

Coding 与 Learning 暂作为验证 Core 通用性的后续 Mode Adapter，不在当前阶段同时做成完整产品。

## 7. 当前边界

本 PRD 当前不规定：

- Adaptive Roadmap 的最终 Schema、调度算法和持久化格式；
- Multi-Agent 的固定角色数量；
- Verification 的具体模型、评分器或阈值；
- RAG、长期记忆或自进化的最终实现；
- Research Workspace 的最终 UI 布局；
- Coding / Learning 模式的完整产品设计。

这些内容应在对应 Phase 中按可验收目标逐步确定，而不是在品牌迁移阶段提前固化。

## 8. 与 SkillWorld 的关系

SkillWorld 是 Navo 的前身。Phase 0–8 主要完成 Agent Harness 与早期 Learning Prototype，验证了 Session、LLM、Tools、Agent Runtime、Node、Search / Fetch、文件工具、RPC 与 Electron 全链路。

自 2026-09-14 起，项目品牌迁移为 Navo，并将产品主线从“Learning-first DAG Agent”调整为“通用 Long-Horizon Agent Core + Research-first Workspace”。原 SkillWorld PRD 作为历史设计保留，不再作为当前产品定义。
