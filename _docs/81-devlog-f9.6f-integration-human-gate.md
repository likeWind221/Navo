# 81：F9.6 Project Workspace 与 Resource Handoff

## 结论

F9.6 已完成 Project Workspace、Resource 生命周期/权限、Node -> Main 协调、Main Resource handoff、Node Turn Context Builder 与 Human Gate 的完整闭环。

本记录整合原 F9.6 总体设计、F9.6a–f 各子步骤以及 Workspace/Resource 模型修订，作为 F9.6 的唯一权威实现记录。

## 最终逻辑架构

```text
Project
  |
  +--> real user Workspace
  |      |
  |      +--> user files
  |      |
  |      +--> .navo/
  |             +--> nodes/
  |             +--> assets/<resource-id>/
  |
  +--> Mailbox
  |      +--> Node -> Main
  |
  +--> ResourceService
  |      +--> stable ResourceId
  |      +--> owner: Main | Node
  |      +--> revision
  |      +--> access: private | shared | project
  |
  +--> Main Agent
  |      +--> read_mailbox
  |      +--> set_resource_access
  |
  +--> Node Agent
         +--> register_resource
         +--> fetch_resource
         +--> update/delete own Resource
         +--> send_to_main
         +--> Turn-start Context Builder
```

核心原则只有两个：

1. **Main 是唯一跨 Node 协调者。**
2. **任何消息、Resource 或依赖变化都不能自动启动 Node。**

## Project Workspace

Project 最终直接绑定用户选择的真实目录，而不是在额外的 Navo 根目录下复制一层 Project：

```text
<user-project>/
  +-- existing user files
  +-- .navo/
       +-- nodes/
       +-- assets/
       +-- skills/   # 仅预留
```

Navo 自身管理文件只能进入 `.navo/`。普通用户文件仍属于真实 Project Workspace。

Workspace 层负责：

- existing directory binding；
- canonical path；
- Project containment；
- 绝对路径、`..`、反斜杠和非法 segment 拒绝；
- symlink escape 拒绝；
- 同 Project 不可静默换 root；
- 同一 root 不被多个 Project 同时绑定。

Project-bound FileEnvironment 即使 Host 的全局 cwd 更大，也不能逃出当前 Project root。

F9 中 Workspace binding 仍是内存状态；F10 再实现持久恢复。

## Mailbox

Mailbox 是 Project 级 append-only 消息事实源。

领域层只允许：

```text
Node -> Main
Main -> Node
```

但 F9.6 最终产品链路主要使用 **Node -> Main report**。任务变化不再创建 Directive 作为第二套任务事实源，而继续通过 F9.5 的 Roadmap mutation 表达。

约束包括：

- Project 必须存在且 active；
- participant Node 必须是当前 Project 的 work Node；
- control Node 不能作为 Agent message participant；
- Node-to-Node、Main-to-Main route 被拒绝；
- replay 要求 sequence 连续、MessageId 唯一、Project/Node 归属合法；
- append message 不触发 AgentRuntime。

F9.6f 补齐 Main-only `read_mailbox`，使 Node 写入的报告真正成为模型可消费信息。读取不消费消息、不维护 unread/read receipt，也不启动任何 Agent。

## Resource 最终领域模型

Resource 不是“目录扫描出来的文件”，而是稳定领域对象：

```text
Resource
  +-- id: stable ResourceId
  +-- projectId
  +-- owner: Main | Node
  +-- source/provenance
  +-- name / description / type
  +-- entryRef
  +-- revision
  +-- access
       +-- private
       +-- shared(nodeIds)
       +-- project
```

物理正文被复制为稳定快照：

```text
.navo/assets/<resource-id>/<entryRef>
```

身份与路径分离；文件名或目录变化不能隐式改变 Resource identity。

### Service 是唯一写边界

Resource 生命周期只能经过 ResourceService：

- create/register；
- fetch；
- update metadata；
- change access；
- delete；
- replay/restore。

底层 Store 不公开给调用方，避免绕过 Service 修改事实。

所有 mutation 使用 revision 做 optimistic concurrency；stale revision 被拒绝。

### Ownership 与 Access 分离

```text
owner
  -> CRUD own Resource

Main
  -> read Project Resource
  -> set access
  -> cannot update/delete Node-owned Resource

shared/project viewer
  -> read only
```

新 Resource 默认 `private`。

Node owner 不能直接把 Resource 授权给其他 Node；只有 Main 拥有跨 Node access handoff 权限。

`shared` 目标必须是同 Project work Node；control Node、跨 Project Node、重复 Node 都被拒绝。

普通文件 Tool 不允许直接进入 `.navo/assets` 绕过 Resource ACL；Resource 正文必须通过 `fetch_resource` 在 ACL 校验后读取。

## Agent Capability 边界

### Node

Node 通过 trusted Session Binding 获得：

- `register_resource`
- `fetch_resource`
- `update_resource` / `delete_resource`（仅 own）
- `send_to_main`

caller 的 Project/Node identity 来自 Session Binding，而不是模型参数。

### Main

Main 通过 trusted Main Session Binding 获得：

- Resource owner CRUD（仅 Main-owned）
- Project Resource read
- `read_mailbox`
- `set_resource_access`

Main 能协调 Resource 可见性，但不能冒充 Node owner 修改其 Resource。

## Context Builder

F9.6e 引入 `NodeTurnContextBuilder`，把 Project、Node 与当前可见 Resource metadata 组装成 **Turn-start snapshot**：

```text
Human starts Node Turn
        |
        v
NodeTurnContextBuilder.build()
        |
        +--> Project facts
        +--> Node objective
        +--> visible Resource metadata
        |
        v
Node Agent Profile
        |
        v
AgentRuntime
```

Context Builder 是“读取 + 裁剪”层，不是新的事实源：

- private Resource 对非 owner 不可见；
- own/shared/project Resource 只注入最小 metadata；
- Resource 正文、物理路径、ACL、其他 Node ID 不进入 prompt；
- snapshot 构建后保持不变；
- access 变化只会在**下一次 Human-started Turn**重新 build 时可见；
- 不实现 watcher、动态 reload、durable injection 或 RAG。

正文始终按需通过 `fetch_resource(resource_id)` 获取。

## Main Resource Handoff

Main handoff 只改变 Access，不改变 Ownership：

```text
Node A owns Resource
        |
        v
Main set_resource_access(shared Node B)
        |
        +--> owner remains Node A
        +--> Node B gains Read
        +--> no Node execution
```

支持：

- private
- shared(nodeIds)
- project

Tool 自身要求 Main Binding，且 schema shape 在 Tool 边界严格归一化。stale revision、非法 shared target 和错误 access shape 均被拒绝。

## Human Gate 与完整闭环

F9.6 最终验收链路：

```text
Human start Node A
        |
        v
register_resource
        |
        v
send_to_main
        |
        v
Project Mailbox
        |
Human start Main
        |
        v
read_mailbox
        |
        v
set_resource_access(shared Node B)
        |
        X  Node B 不自动执行
        |
Human start Node B
        |
        v
NodeTurnContextBuilder
        |
        v
fetch_resource
        |
        v
read Resource body
```

handoff 后明确保持：

- Node B status 仍为 `idle`；
- 没有自动 Session；
- Node event history 不因 handoff 增长；
- 只有 Human 显式启动后才产生 Turn。

这也是 F9.7 继续沿用的核心执行原则。

## 设计演进

F9.6 中途有一次重要架构修订：

### 初版

```text
NAVO_WORKSPACE/projects/<project>
  +-- assets
  +-- nodes
Resource Registry -> workspace-relative ref
```

### 最终

```text
真实用户 Project root
  +-- user files
  +-- .navo/
       +-- assets/<resource-id>
       +-- nodes
```

同时 Resource 从简单 Registry record 收敛为由 ResourceService 管理的稳定生命周期对象，并加入 owner、revision 与 ACL。

这一迁移不是推翻 F9.6b/F9.6c 的领域原则，而是将“独立 Project workspace + stable Resource identity”改造成更适合真实代码仓库/论文目录的物理模型。

## 验证

F9.6 最终 GitHub Windows CI：

```text
pnpm typecheck  PASS
pnpm test       PASS

72 test files
425 tests
425 passed
```

核心覆盖包括：

- Mailbox route / replay / Project ownership；
- Workspace path containment 与 symlink escape；
- Resource lifecycle / revision / replay；
- Main/Node owner CRUD；
- shared/project read-only access；
- `.navo` ACL 防绕过；
- Node -> Main report；
- Main-only mailbox read；
- Main-only access handoff；
- Context Builder metadata-only snapshot；
- handoff 不自动执行 Node；
- Human-started Node B 按 ResourceId 获取正文。

## 后续边界

F9.6 明确没有实现：

- 自动 Scheduler；
- Agent 递归唤醒；
- unread/read receipt；
- RAG / vector retrieval；
- dynamic Resource reload；
- database persistence；
- Host/RPC/frontend Project contract。

下一步进入 **F9.7 Human-Controlled ProjectRuntime**：统一 Project 执行入口与 Human 操作，但继续复用现有 Node 五态和单一 AgentRuntime。
