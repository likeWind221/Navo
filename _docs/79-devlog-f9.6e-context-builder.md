# 79：F9.6e Node Turn Context Builder

## 做了什么

F9.6e 先落地 Context Builder 子阶段，把 Node Turn 的上下文获取从 `NodeSessionService` 与 `NodeAgentProfile` 中拆出。新增 `NodeTurnContextBuilder`：每次 queued Turn 真正开始执行时，从权威 Project / Node / Resource 事实源构建一次不可变快照，再交给 Profile 渲染。

```text
Human start / queued Turn
        |
        v
NodeSessionService
        |
        v
NodeTurnContextBuilder
   |        |        |
 Project   Node   ResourceService
                     |
                listVisible(node)
        |
        v
NodeTurnContext snapshot
        |
        v
NodeAgentProfile
        |
        v
AgentRuntime.runTurn()
```

当前 snapshot 只包含 Project goal、Node objective/status，以及当前 Node 可见 Resource 的最小 metadata：`id / name / description / type / revision / ownedByCurrentAgent`。

## 关键决策

### Context Builder 是事实读取与裁剪层

`ResourceService` 仍负责“这个 Node 有权看到什么”；Context Builder 负责“这些可见事实中哪些应该进入本轮模型上下文”。Profile 不再直接查询 Store/Service，只渲染已经构建好的 Turn Context。

Resource 正文、`entryRef`、真实路径、完整 access、shared Node IDs 和其他 owner Node ID 都不进入 Prompt。Node 需要正文时继续按 Resource ID 调用 `fetch_resource`。

### Turn Snapshot，不做动态 reload

Builder 在每个 Turn 真正进入 Runtime 前重新执行。某个 snapshot 构建后，即使 Main 随后改变 Resource access，当前 Turn 的 snapshot 不被修改；下一次 Human-started Turn 才重新读取最新事实。

因此 Resource 到位不会自动启动 Node，也不会向正在运行的 Turn 推送上下文。F9.6e 当前不实现 watcher、动态 prompt mutation、RAG 或 Context subscription。

### Profile 只负责模型呈现

`NodeAgentProfile` 现在接收 `NodeTurnContext`，分别渲染：

```text
<node-context>
  Project goal / objective / status
</node-context>

<available-resources>
  metadata only
</available-resources>
```

Resource name/description 等外部文本在最终渲染边界统一转义，避免伪造 XML-like delimiter。Profile 同时明确 `ownedByCurrentAgent=true` 才表示可 update/delete，其他列出的 Resource 只读。

### DeepSeek Harness 对照

只读参考 DeepSeek Harness：

- `.agents/notes/archived/feature/2026-06-24-workspace-context.md`：模型上下文应按 session/request 生命周期构建，并避免一个 workspace 的上下文泄漏到另一个 session；
- `docs/architecture.md` 的 Turn flow：模型请求前完成 prompt/context assembly，而不是让领域状态直接修改 Runtime；
- Harness 的动态 context 使用 durable session event / `agent.inject()`，因为它需要恢复、动态文件变化和多 step 注入。Navo 当前 Human Gate 更简单，本阶段只采用 request-boundary context construction 与隔离原则，不复制动态 watcher、durable context event 或实时 injection。

## 坑与发现

- Profile 从 `NodeSnapshot` 改为 `NodeTurnContext` 后，旧 control-node 单测仍调用旧签名；控制 Node 是否能进入 Agent 上下文现在属于 Builder 边界，因此测试迁移到 `NodeTurnContextBuilder.build()` 拒绝控制 Node。
- `NodePlugin` 当前先挂 Node Session、后由 NavoApp 挂 ResourceService。为避免为了 Context Builder 重排整个插件树，NodeSession 使用 Cordis `ctx.inject(["projects", "nodes", "resources"], ...)` 在 Resource capability 可用时安装 Builder；真实 Turn 若该依赖尚未就绪会明确失败，而不会构造残缺上下文。
- Context Builder 本身保持无缓存；Resource visibility 每个 Turn 重新读取，避免引入第二套失效策略。

## 验证

自动测试覆盖：

- private Resource 不出现在非 owner Node context；
- own/shared Resource 只投影最小 metadata；
- Resource 正文、路径、ACL/其他 Node ID 不进入 snapshot；
- 已构建 snapshot 在后续 access 变化后保持不变；
- 下一次 build 能看到新授权 Resource；
- Resource metadata 的 delimiter 文本被转义；
- 真实 NodeSession 第一次 Turn 看不到未授权 Resource；
- Main 授权本身不启动 Node；
- 下一次 Human-started Turn 重新 build 后才出现 Resource metadata。

F9.6e 仍未完成：Main Agent 的正式 `set_resource_access` / handoff capability 尚未实现，因此本阶段保持 **🔄**。

## 下一步

继续 F9.6e 的 Main Resource Handoff 子阶段，把 ResourceService 已有的 Main-only `setAccess` 接成可信 Main Agent capability；随后再进入 F9.6f 做 Node A -> Main -> Node B 的完整 Human Gate 集成验收。
