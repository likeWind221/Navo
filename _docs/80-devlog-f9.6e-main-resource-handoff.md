# 80：F9.6e Main Resource Handoff

## 做了什么

F9.6e 的第二个子阶段把 ResourceService 已有的 Main-only access 领域能力接成模型可调用的 `set_resource_access` Tool。Main 可以把任意当前 Project Resource 从 private 切换为定向 shared、提升为 project，或重新收回 private；Resource owner 不发生变化。

```text
Main Agent
    |
    | set_resource_access
    v
Trusted Main Session Binding
    |
    v
ResourceService.setAccess()
    |
    +-- private
    +-- shared(nodeIds)
    +-- project
    |
    v
Resource revision + access changed
    |
    X  no Node start
    X  no Roadmap mutation

next Human-started Node Turn
    |
    v
NodeTurnContextBuilder
    |
    v
new visible Resource metadata snapshot
```

## 关键决策

### Handoff 只改变 Access，不改变 Ownership

owner 继续表示 Resource 内容和 metadata 的维护者；Main 的协调权只体现在 `setAccess`。因此 Main 可以分发 Node-owned Resource，但不能借 handoff 修改或删除 Node-owned Resource。

### Tool 本身要求 Main Binding

`set_resource_access` 不接受 projectId 或 caller identity。执行时通过 `requireMainBinding(sessionId)` 获取可信 Project 身份。Node Profile 不暴露该 Tool；即使 Node 绕过 Profile 直接调用已注册 Tool，Main Binding 校验仍会拒绝。

### Tool Schema 与领域联合类型分离

Navo 当前 model-facing JSON Schema 子集不支持 `oneOf`。因此 Tool Schema 使用一个 `access` object：

```text
access.kind = private | shared | project
access.node_ids = optional string[]
```

随后 Tool 运行时严格归一化：

- private/project 不允许携带 node_ids；
- shared 必须携带非空 node_ids；
- 最终转换回领域层的 `ResourceAccess = private | shared(nodeIds) | project`。

同 Project、work Node、重复 Node、owner Node 等更深业务规则继续由 ResourceService/access domain 校验，不在 Tool 层复制第二套授权事实。

### Human Gate 保持不变

Main handoff 只追加 Resource access event 和 revision。它不会：

- start/unlock/complete Node；
-修改 Roadmap；
- 动态修改已经运行中的 Node Turn；
- 向 Node push Resource 正文。

新 access 只影响后续 `listVisible()`；Node 下一次 Human-started Turn 时由 Context Builder 重新 build snapshot。

### DeepSeek Harness 对照

只读参考 DeepSeek Harness：

- `packages/session-query/tool-session-query/src/workspace-access.ts`：Tool 调用者身份来自运行上下文，授权边界不由模型参数自行声明；Navo 对应使用 trusted Session Binding；
- `packages/session-query/tool-session-query/src/input.ts`：模型参数在 Tool 边界先归一化和严格验证，再进入领域 Service；
- `packages/core/tools/src/schema.ts` 支持 `oneOf`，而 Navo 当前简化 Schema 尚不支持，因此本阶段没有扩展整个 Tool Schema 引擎，只在 handoff Tool 执行边界完成判别联合归一化，避免为单一能力扩大底层协议范围。

## 坑与发现

- 新增全局 Tool 后，Host/Integration 中的完整 Tool catalog 测试需要同步加入 `set_resource_access`；Desktop 和 Node 的实际 allowedTools 仍明确不包含该 Main-only Tool。
- 一次测试补丁因只检查常量名是否存在，误判 assertion 中的引用等同于 import；后续改成检查具体 import 行。生产实现未因此变化。

## 验证

GitHub Actions Windows CI：

```text
pnpm typecheck  PASS
pnpm test       PASS

70 test files
422 tests
422 passed
```

关键场景：

- Main 可完成 private -> shared -> project -> private；
- shared 后目标 Node 可读，收回 private 后不可读；
- Node 即使直接调用已注册 Tool 仍被 Main Binding 拒绝；
- stale revision 被拒绝；
- private/project 携带 node_ids 等非法 access shape 被拒绝；
- control Node、跨 Project Node 不能作为 shared target；
- handoff 成功不产生目标 Node execution event；
- Main Profile 暴露 handoff Tool，Node Profile 不暴露；
- Desktop/普通 Node Runtime 不因全局注册而获得该能力。

当前 F9.6e 代码实现已完成，但仍等待本机 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`，因此整体保持 **🔄**，PR #22 暂不合并。

## 下一步

本机与最终 head CI 双重通过后正式收口 F9.6e。下一步进入 F9.6f Integration + Human Gate，验证 Node A 注册 Resource -> send_to_main -> Main handoff -> Node B 保持 idle -> Human 启动 Node B -> Context Builder 发现 Resource -> fetch_resource 的完整链路。
