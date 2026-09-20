# 71：F9.6 Project Workspace 与 Resource Handoff 设计

> **设计修订（2026-09-20）：** 本文记录 F9.6 最初收敛方案。进入 Node Resource capability 前，Workspace 与 Resource 模型进一步调整：Project 直接绑定用户选择的真实目录，Navo 内部文件只写入 `.navo/`；Resource 继续作为稳定领域对象，由服务接口管理生命周期与权限，不采用动态目录扫描作为事实源。后续权威设计见 [75：F9.6 Workspace 与 Resource 最终模型修订](75-devlog-f9.6-workspace-resource-revision.md)。本文保留为设计演进轨迹。

## 1. 背景

F9.5 已完成 Main Agent 的 Roadmap 读取、创建与修改闭环，F9.6a 已完成 Project Mailbox Domain。经过 F9.6a 后的继续讨论，F9.6 不再沿用“Directive + Asset Assignment + 全局资源搜索”的复杂协调模型，而收敛为更直接的 Project 工作模型：

```text
Roadmap
   = Node 要做什么

Mailbox
   = Node 向 Main 报告什么

Project Workspace
   = Project 的实际文件放在哪里

Resource Registry
   = Project 有哪些重要可复用资源

Human
   = Node 是否真正开始执行
```

Navo 仍然不是依赖满足后自动运行的 Workflow Engine。Main 负责全局规划和跨 Node 协调，Node 是局部执行单元，每个 Node Turn 必须由 Human 明确启动。

## 2. 最终功能模型

### 2.1 每个 Project 拥有独立 Workspace

Project 的真实文件不挂在 Session 上，而进入当前 Project 的独立工作空间：

```text
<NAVO_WORKSPACE>/
└── projects/
    ├── project-a/
    │   ├── assets/
    │   └── nodes/
    │       ├── node-a/
    │       └── node-b/
    │
    └── project-b/
        ├── assets/
        └── nodes/
```

Workspace 是物理文件边界。不同 Project 的路径必须隔离；领域和 Agent 层只保存 Project 内相对引用，不把机器绝对路径作为稳定 Resource 身份。

### 2.2 Resource Registry 描述“有什么”，Workspace 保存“内容在哪里”

Resource Registry 不等同于文件系统，也不是 RAG。

```text
Resource
├── id
├── projectId
├── sourceNodeId
├── title
├── description
├── type
└── ref            # Project Workspace 内的相对引用
```

例如：

```text
resource_001
title: A2A 协议调研
description: Node A 生成的 A2A 架构与 Artifact 机制调研
ref: assets/a2a-report.md
```

F9 阶段 Registry 只保存在内存中；F10 再统一持久化 Registry、Project、Roadmap、Mailbox 等状态。实际文件从 F9.6b 起已经可以存在 Project Workspace 中。

### 2.3 Resource metadata 借鉴 Skill 的“可发现 + 按需加载”机制

Node 不应该在启动时把所有 Resource 正文塞入模型上下文。更合理的方式是让 Node 持续知道自己有哪些可用资源：

```text
Available Resources

resource_001
A2A 协议调研
用于后续架构比较与协议分析

resource_002
实验结果汇总
包含上游 Node 生成的统计结果
```

真正需要内容时再读取对应 Resource。

因此当前设计不需要额外的 `list_resources` Agent Tool：可用 Resource metadata 本身就是 Node 启动上下文的一部分。后续如果 Project 资源规模很大，再引入检索或 RAG。

### 2.4 Resource 注册自动绑定当前 Project / Node

Node Agent 后续调用 `register_resource` 时，模型只描述资源本身，不提交可信身份：

```text
Node Session
    |
    v
Trusted Binding
    |
    +--> projectId
    +--> nodeId
    |
    v
register Resource
```

`projectId`、`sourceNodeId` 必须从 Session Binding 派生，不能接受模型伪造。

### 2.5 Main 不再使用 Directive 作为第二套任务事实源

如果 Main 需要改变 Node B 的工作目标、done_when 或路线关系，继续使用现有 Roadmap mutation。

```text
Main
├── modify_roadmap()       -> 改“做什么”
└── handoff resource       -> 给“用什么”
```

不新增 Directive 领域对象，避免出现 Roadmap 和 Directive 同时定义任务而互相冲突。

### 2.6 Mailbox 继续作为消息事实层

F9.6a 已经支持 Node -> Main 与 Main -> Node 的合法路由。后续核心产品链路主要使用 Node -> Main report：

```text
Node A
  |
  | report result / blocker / planning_request
  v
Mailbox
  |
  v
Main
```

现有 Main -> Node route 不需要在 F9.6 立即删除，但不再围绕它建立 Directive 产品语义。

## 3. F9.6 Step 拆分

### F9.6a Project Mailbox Domain ✅

已完成。

负责 Project 级 append-only message history、合法路由、Project / work Node 归属与 replay 校验。写消息本身不触发 AgentRuntime。

### F9.6b Project Workspace Foundation

目标：先建立 Project 文件的物理边界，不做 Registry。

实现范围：

- 每个 Project 有独立 Workspace root；
- 建立 Project Workspace 创建 / 获取 / 清理的基础领域能力；
- 提供 Project 内相对路径解析；
- 拒绝 `..` 等路径逃逸和跨 Project 访问；
- 为后续 `assets/` 与 Node 工作目录预留稳定结构；
- 不修改 Host / RPC / frontend 契约。

验收重点：

```text
project-a ref
     |
     v
project-a workspace

project-b ref
     |
     v
project-b workspace

project-a ----X----> project-b files
```

F9.6b 不创建 Resource Registry、不增加 Agent Tool、不做数据库持久化。

### F9.6c Project Resource Registry

目标：让 Workspace 中的重要产物成为 Project 内可追踪 Resource。

实现范围：

- Resource model；
- in-memory ResourceStore / Registry；
- create / get / listByProject；
- Resource 保存 source Node 和 Project 内相对 ref；
- 校验 source Node 属于当前 Project；
- 拒绝跨 Project Resource 引用；
- Registry restore / replay 规则保持可测试、确定性。

F9.6c 只解决“Project 有什么资源”，不负责模型如何读取资源。

### F9.6d Node Reporting 与 Resource Capability

目标：把已有 Mailbox / Resource 领域能力安全接到 Node Agent。

Node 能力包括：

- `register_resource`：为当前 Node 已产生的工作产物注册 Resource；
- `fetch_resource(resource_id)`：读取当前 Node 被允许使用的 Resource 内容；
- `report_to_main`：报告 result、blocker、coordination_request、planning_request，并可附带 Resource Reference。

可信边界：

- caller identity 来自 `execution.sessionId -> requireNodeBinding()`；
- Node 不能伪造 projectId / sourceNodeId；
- Node 不得直接指定并联系另一个 Node；
- `result` 不自动把 Node 置为 completing；
- `planning_request` 不赋予 Node Roadmap mutation 权限。

### F9.6e Main Resource Handoff 与 Node Resource Context

目标：Main 决定哪些 Project Resource 对某个 Node 可见，并让这些 Resource metadata 在该 Node 后续 Turn 中可发现。

Main 负责：

```text
Main
   |
   +--> 修改 Node 任务：modify_roadmap()
   |
   +--> 提供 Resource：attach_resource_to_node()
```

Node 启动上下文只注入：

- resource id；
- title；
- description；
- 必要的类型 /来源摘要。

不默认注入完整文件内容。Node 真正使用时再 `fetch_resource`。

本 Step 只实现当前 Turn / 启动时的 Resource Context，不抽象通用 Context Builder，也不实现动态 Tool / Skill / Resource reload。未来可以统一设计 `refresh_context` / Context Builder。

### F9.6f Integration 与 Human Gate

使用完整场景验收：

```text
Human start Node A
       |
       v
Node A 工作
       |
       +--> workspace 生成文件
       |
       +--> register_resource()
       |
       +--> report_to_main()
       v
Mailbox + Resource Registry
       |
       v
Main
       |
       +--> modify_roadmap()（必要时）
       |
       +--> attach_resource_to_node(Node B)
       v
Node B 获得 Resource metadata
       |
       X  no auto-run
       |
       v
Human start Node B
       |
       v
Node B fetch_resource() / continue work
```

验收必须证明：

- Node B 不因 Resource 到位自动启动；
- Node A 无 Node-to-Node 通道；
- Resource 来源与 Project 归属可追溯；
- Node B 只能读取自己被提供的 Resource；
- Roadmap 修改仍只能由 Main 完成；
- 整条链不依赖自动 Scheduler。

## 4. 与 Skill / Tool / Context 的关系

Resource metadata 的设计借鉴 Skill Registry：模型持续知道“有哪些资源以及它们适合做什么”，真正内容按需加载。

但 F9.6 暂不统一 Tool Registry、Skill Registry 与 Resource Registry，也不实现动态刷新。未来更完整的 Context Management Layer 可以形成：

```text
Tool Registry      Skill Registry      Resource Registry
      \                |                /
       \               |               /
              Context Builder
                    |
                    v
                AgentRuntime
```

当会话中新增 Tool / Skill / Resource 时，可进一步设计 context invalidation / reload。该问题不阻塞当前 Resource 基础设施。

## 5. 与 RAG 的关系

Resource Registry 是“Project 有哪些长期资源”的事实层；RAG 是“资源很多时如何检索相关内容”的检索层。

```text
Workspace / Resource Registry
            |
            v
      Retrieval Index
            |
      chunk / embedding
            |
            v
           RAG
```

因此 F9.6 不实现 embedding、chunk、向量数据库或语义检索。后续 RAG 可以建立在稳定 Resource ID 与 provenance 之上，而无需改变资源来源模型。

## 6. F9.6 明确不做

- 不允许 Node-to-Node 直接通信；
- 不新增 Directive 作为任务事实源；
- 不给 Node `read_roadmap` 或 `modify_roadmap`；
- 不因依赖满足、Mailbox 消息或 Resource 到位自动启动 Node；
- 不把所有 Resource 正文默认塞进 Agent Context；
- 不实现 `list_resources` Agent Tool；
- 不实现动态 Tool / Skill / Resource reload；
- 不抽象完整通用 Context Builder；
- 不做 RAG、embedding、vector database；
- 不在 F9.6 修改 Host / RPC / frontend 共享契约；
- Resource Registry 在 F9 不落数据库，F10 再统一持久化。

## 7. 当前下一步

当前唯一下一步为 **F9.6b Project Workspace Foundation**。

先解决一个问题：

> 一个 Project 的文件到底属于哪里？

完成后再进入 F9.6c Resource Registry，解决：

> Workspace 中哪些产物值得成为 Project 长期可复用 Resource？
