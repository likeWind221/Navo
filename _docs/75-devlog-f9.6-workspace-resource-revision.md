# 75：F9.6 Workspace 与 Resource 最终模型修订

## 1. 修订原因

F9.6b 与 F9.6c 已分别完成 Project Workspace Foundation 和内存 Resource Registry。进入 Node Resource capability 前，对真实代码项目使用方式、Resource 生命周期、来源追踪和跨 Node 权限再次复审，得到两项关键调整：

1. Project Workspace 不再由 Navo 在统一根目录下创建 `projects/project-<safe-key>`，而是直接绑定用户选择的真实工作目录；
2. Resource 不采用类似 Skill 的目录动态扫描模型，而继续作为稳定领域对象，由统一 Resource Service 管理生命周期与权限。

这次调整保留 F9.6b/F9.6c 作为已完成历史步骤，通过后续迁移 Step 收敛到最终模型，不回写历史实现。

## 2. 最终逻辑架构

```text
Project
|
+-- Goal / Roadmap
|
+-- Main Agent
|
+-- Nodes
|
+-- Mailbox
|     = Project 内通信事实
|
+-- Resource Service
|     = Resource 身份、来源、元数据、权限与生命周期事实
|
+-- Workspace
      = 用户真实项目目录 + Navo 文件内容
```

职责保持分离：

```text
Roadmap
= 做什么

Mailbox
= Agent 之间发生了什么

Resource Service
= Project 有哪些正式资产、谁产生、谁能访问

Workspace
= 用户真实项目文件以及 Resource 的实际内容

Main
= 跨 Node 决策、资源授权与协调
```

Mailbox、Roadmap、Resource metadata 在 F9 仍是内存领域状态，F10 再统一接数据库持久化。它们不是 Workspace 文件夹。

## 3. 最终真实目录结构

Project 直接绑定用户选择的任意已有目录，例如代码仓库、论文工程或普通工作目录：

```text
<user-workspace>/
|
+-- src/                  # 用户已有内容，Navo 基础设施不拥有
+-- tests/
+-- docs/
+-- package.json
+-- .git/
+-- ...
|
+-- .navo/                # Navo 唯一内部文件区
    |
    +-- assets/
    |    +-- <resource-id>/
    |         +-- <entry file>
    |         +-- ...subresources
    |
    +-- nodes/
    |    +-- <node-id>/
    |         +-- ...private working files
    |
    +-- skills/           # 后续 Project-local Skills 预留
```

关键规则：

- Navo 基础设施产生的管理文件只允许进入 `.navo/`；
- `.navo/` 外的用户文件属于真实 Project Workspace，只有 Agent 执行用户任务时才通过受控文件能力读写；
- 不再存在 `<NAVO_WORKSPACE>/projects/project-<safe-id>` 这一额外目录层；
- `.navo/assets` 保存正式 Resource 内容；
- `.navo/nodes` 保存 Node 私有工作区、草稿和中间文件；
- `.navo/skills` 只作为后续能力预留，本阶段不实现。

## 4. Workspace 安全边界

文件访问分两层：

```text
Node ordinary file capability
        |
        v
Project Workspace boundary
        |
        X 不能逃逸到其他目录

fetch_resource(resourceId)
        |
        v
Resource authorization
        |
        v
<workspace>/.navo/assets/<resource-id>/
        |
        X 不能越出当前 Resource root
```

因此：

- Node 的普通文件工具可以服务真实代码开发，但必须受当前 Project Workspace containment 约束；
- Resource 读取不仅要满足 Project Workspace containment，还必须先通过 Resource 权限校验；
- Resource 的子文件读取仍然不能因为知道路径而绕过 Resource 权限。

## 5. Resource 最终领域模型

Resource 是正式、稳定、可审计的 Project 资产对象，而不是由文件系统扫描推断出的瞬时目录项。

推荐模型：

```text
Resource
+-- id                 # 稳定 ResourceId，不变
+-- projectId
+-- name               # 人和 Agent 可读名称；不再额外保留 title
+-- description
+-- type
+-- sourceNodeId       # 可信 Binding 决定来源
+-- visibility         # private | project
+-- allowedNodeIds     # Main 定向授权
+-- entryRef           # Resource root 内主入口文件
+-- createdAt
+-- updatedAt
+-- revision
```

Resource 身份、名称、权限或内容入口发生变化时，必须通过 Resource Service API；不能通过目录 rename、文件扫描或直接修改 Store 隐式改变领域事实。

F9：

```text
Resource Service
      |
      v
In-memory Resource Store
```

F10：

```text
Resource Service
      |
      v
Persistent Resource Repository
      |
      v
Database
```

上层 Agent capability 不因持久层替换而改变。

## 6. Resource 物理内容模型

每个正式 Resource 拥有固定 Resource root：

```text
.navo/assets/<resource-id>/
|
+-- <entryRef>          # 主入口，例如 report.md
+-- results.csv
+-- figures/
+-- ...
```

Resource metadata 不复制正文；`entryRef` 只允许解析到该 Resource root 内。

因此：

```text
ResourceId
   |
   v
Resource Service
   |
   +-- metadata / permission
   |
   v
Project Workspace
   |
   v
.navo/assets/<resource-id>/<entryRef>
```

## 7. Resource 权限模型

F9.6 先保持最小权限集合：

```text
private
  -> Main + source Node 可读

private + allowedNodeIds
  -> Main + source Node + Main 明确授权的 Node 可读

project
  -> Main + 当前 Project 所有 work Node 可读
```

原则：

- Node 创建 Resource 时默认 private；
- Node 不能自行给其他 Node 授权；
- Main 是唯一跨 Node Resource 分发者；
- 未授权 Node 不应通过猜测 ResourceId/name 获知私有资源存在；
- 权限变化也必须经过 Resource Service，而不是修改 Workspace 文件。

## 8. Node 侧最终能力

Node Agent 后续只需要三个高层能力：

```text
register_resource(...)
  -> 创建正式 Resource
  -> projectId/sourceNodeId 来自 trusted Session Binding

fetch_resource(resource_id)
  -> 校验 caller Binding
  -> 校验 Resource visibility/grant
  -> 读取 Resource 主入口内容

send_to_main(message)
  -> Node -> Main 单向文本通信
  -> 不接受 projectId / nodeId / targetNodeId
```

`send_to_main` 是通用通信能力，不只用于 Resource 汇报。任何需要进入 Main 全局决策流程的信息都可发送，例如阻塞、阶段结果、协调需求或规划建议。Mailbox 仍只保存文本消息，不新增第二套 Directive/Report 事实模型。

## 9. Main 侧后续能力

Main 后续负责：

```text
Main
|
+-- modify_roadmap(...)
|
+-- grant Resource -> Node
|
+-- revoke Resource -> Node
|
+-- mark Resource project-shared
```

Node 获得 Resource 权限不会自动启动；Human Gate 保持不变。

## 10. 与 Skill 模型的最终关系

Resource 和 Skill 只共享“metadata 可发现、正文按需读取”的体验，不共享生命周期模型：

```text
Skill
= 环境能力发现
= 可以由 provider / filesystem 动态提供

Resource
= Project 资产事实
= 稳定身份 + provenance + permission + lifecycle
= 只能经 Resource Service 改变
```

因此最终不采用“扫描 `.navo/assets` 自动生成 Resource”的方案。

## 11. F9.6 Plan 调整

原 F9.6d 同时承担 Workspace、Resource 和 Node tool 会过大，因此拆为：

```text
F9.6d.1
Project Workspace Root Migration
  -> 用户目录 + .navo

F9.6d.2
Resource Lifecycle & Access Domain
  -> 稳定 Resource + CRUD/service + permission

F9.6d.3
Node Resource & Main Communication Capability
  -> register_resource
  -> fetch_resource
  -> send_to_main

F9.6e
Main Resource Handoff & Node Resource Context

F9.6f
Full Integration & Human Gate
```

F9.6b/F9.6c 保持 ✅，因为它们记录了当时已完成并验收的基础实现；F9.6d.1/F9.6d.2 明确承担最终模型迁移，而不是伪装成历史步骤从未完成。

## 12. 当前下一步

当前唯一下一步为 **F9.6d.1 Project Workspace Root Migration**。

这一 Step 只迁移 Workspace 根目录与安全边界，不同时重构 Resource 权限和 Agent capability。
