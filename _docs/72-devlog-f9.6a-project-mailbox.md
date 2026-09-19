# 72：F9.6a Project Mailbox Domain

## 目标

F9.6a 只建立 Project 级通信事实层，不接 Agent 工具、不接 Project Asset、不触发 AgentRuntime，也不修改 Host / RPC / frontend。

本 Step 回答的问题是：**Main 与 Node 的通信如何先成为可追溯、可重放、受 Project 边界约束的事实。**

```text
Node Agent                          Main Agent
    |                                   |
    | postFromNode                      | postFromMain
    v                                   v
+------------------------------------------------+
|               Project Mailbox                  |
|                                                |
|   Node -> Main      ✅                          |
|   Main -> Node      ✅                          |
|   Node -> Node      X                           |
|   Main -> Main      X                           |
+------------------------------------------------+

append message != run another Agent
```

## 实现

新增 `src/mailbox`：

- `model.ts`：定义 `ProjectMessage`、Main / Node participant 与两个单向提交输入；
- `errors.ts`：定义 Mailbox 领域错误；
- `store.ts`：按 Project 维护 append-only message history，支持 `postFromNode`、`postFromMain`、`getHistory`、`restore`；
- `src/app.ts`：在 Node 领域挂载完成后注册 `MailboxStore`。

没有提供允许调用方自由填写 sender / recipient 的通用 `send()`。合法方向直接由领域 API 表达：

```text
postFromNode(projectId, nodeId, body)
    -> sender = Node(nodeId)
    -> recipient = Main

postFromMain(projectId, nodeId, body)
    -> sender = Main
    -> recipient = Node(nodeId)
```

因此 F9.6a 的正常写入路径不存在 Node-to-Node 通道。

## 领域约束

每条消息包含稳定 `MessageId`、`ProjectId`、Project 内连续 `sequence`、时间、sender、recipient 和 body。

写入时验证：

- Project 必须存在且为 active；
- Node 必须是当前 Project 的 work Node；
- control Node 不能成为 Agent Mailbox participant；
- body 不能为空；
- 路由只能是 Node -> Main 或 Main -> Node。

恢复历史时重新验证：

- Project 已存在；
- message envelope 合法；
- sequence 从 1 连续递增；
- MessageId 不重复；
- Node 仍属于该 Project；
- Node-to-Node / Main-to-Main 历史被拒绝。

恢复先完成完整校验，再提交 history；失败不会留下部分 Mailbox 状态。导入历史会被复制并冻结，外部修改不能改变已恢复事实。

## 与 Binding 的边界

F9.6a 只验证“这个 Node 是否属于这个 Project”，还没有 Agent Session 身份入口。

例如未来 Node Agent 调用：

```text
Node Session
    |
    v
Trusted Node Binding       <- F9.6c
    |
    v
postFromNode(projectId, nodeId, body)
```

`nodeId` 必须在 F9.6c 从可信 Session -> Node Binding 派生，而不能接受模型自报身份。Main 方向同理由 F9.6d 接入可信 Main Binding。

因此：

- **F9.6a = route / ownership domain boundary**；
- **F9.6c / F9.6d = trusted caller identity boundary**。

两层不能混为一层。

## Human Gate 与 Runtime 边界

Mailbox 写入没有 observer 去启动 Agent，也不依赖 AgentRuntime 才能工作。测试直接只挂载 `ProjectStore + NodeStore + MailboxStore` 即可发送消息。

```text
message appended
     |
     v
Project fact updated
     |
     X  no auto run
     |
Future Human / ProjectRuntime decision
```

所以 Node A 报告消息、Main 给 Node B 留下 directive，都不会使 Node B 自动进入 working。

## 测试

新增 `tests/mailbox/store.spec.ts`，覆盖：

1. Node -> Main 与 Main -> Node 正常追加，并保持 Project 内序号；
2. cross-Project Node 被拒绝；
3. control Node 被拒绝；
4. archived Project 不接受新消息；
5. 空 body 被拒绝；
6. history 可在新 Store 中恢复并继续追加；
7. 导入历史与存储历史相互隔离且冻结；
8. Node-to-Node replay 被拒绝；
9. 非连续 sequence / 不存在 Project 的历史被拒绝且不产生部分提交；
10. Mailbox 可独立于 AgentRuntime 使用，同时已挂载到完整 `NavoApp`。

PR #13 第一轮 GitHub CI 已验证 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test` 全部通过。最终文档提交仍以同一 PR 的最终 CI 为 merge gate。

## F9.6a 完成后的边界

F9.6a 完成后，Navo 已经拥有：

```text
Project
  |
  +-- Roadmap
  +-- Main / Node Binding
  +-- Main planning tools
  +-- Mailbox facts        <- F9.6a
```

但还没有：

```text
Project Workspace        <- F9.6b
Resource Registry         <- F9.6c
Node report / resource    <- F9.6d
Main resource handoff     <- F9.6e
Integration / Human Gate  <- F9.6f
```

**F9.6a 完成后的下一步后来按 2026-09-19 的 F9.6 重规划收敛为 F9.6b Project Workspace Foundation；当前权威拆分以 `71` 与 `backend-plan.md` 为准。**
