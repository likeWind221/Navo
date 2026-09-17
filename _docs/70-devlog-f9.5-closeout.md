# 70：F9.5 Main Agent Planning 收尾

## 结论

F9.5 已完成，可以进入 F9.6 Project Mailbox 与协调。

F9.5 的目标不是让 Main Agent 直接拥有 Project / Node 的任意写权限，而是建立一组受可信 Binding 与领域规则约束的规划 capability，使模型能够读取、创建和增量修改 Roadmap，同时仍由确定性 Core 决定哪些变化可以成为 Project 事实。

## 已完成能力

F9.5 按四个小步完成：

- F9.5a `read_roadmap`：Main Agent 读取当前 Project 的权威 Roadmap、version、依赖与 Node 摘要，不暴露 Node 私有 Session / confirmation。
- F9.5b `read_node`：Main Agent 按 NodeId 读取当前 Project 内单个 Node 的定义与精确 revision，NodeId 只是引用而不是授权。
- F9.5c `write_roadmap`：仅在 Roadmap 不存在时创建初始计划；proposal-local `key` 在可信边界内映射为 Navo 生成的持久 NodeId，并返回 `key -> NodeId` receipt。
- F9.5d `modify_roadmap`：对已有 Roadmap 进行单 action、版本化的增量修改，支持 `add_node`、`edit_node`、`connect`、`disconnect`、`reorder`、`remove_node`。

完整规划闭环如下：

```text
Main Agent
    |
    +--> read_roadmap --------------------+
    |                                     |
    +--> read_node -----------------------+--> current Project facts
    |                                     |
    +--> write_roadmap / modify_roadmap --+
                                            |
                                            v
                                   trusted Main Binding
                                            |
                                            v
                                     RoadmapStore
                                            |
                              validate version / DAG / Node
                                            |
                                            v
                                   authoritative facts
```

## 权限边界

F9.5 完成后，Main Agent 拥有的是“规划权”，不是 Node lifecycle 的最终裁决权。

```text
Main Agent
  +-- create / edit planning definition
  +-- add / remove / reorder Roadmap Node
  +-- connect / disconnect dependencies
  +-- choose required / optional
  X-- confirm Node completion
  X-- mark Node skipped as human confirmation

Roadmap / Node Core
  +-- validate references and DAG
  +-- reject stale Roadmap / Node revisions
  +-- protect working Node definitions
  +-- derive dependency-based locked / idle transitions

Human authority
  +-- completion confirmation
  +-- skip confirmation
```

`remove_node` 只表示把 Node 从当前规划路线中移除，不伪造 `skipped`；Node 历史事实继续存在。

## 一致性与安全性

- Project 身份由 Main Session 的 trusted Binding 推导，不由模型提交 `project_id`。
- `modify_roadmap` 使用精确 `base_version`；`edit_node` 额外要求精确 `node_version`。
- stale version、非法引用、重复关系、cycle、working Node 定义修改等均在提交前被拒绝。
- Node 创建 / 定义事件与 Roadmap change 在候选状态验证通过后才提交，失败不留下部分规划事实。
- Roadmap capability 只进入 Main Agent Profile，工具内部仍重新执行 `requireMainBinding`；Node Session 即使直接 dispatch 也不能越权。
- Main / Node 继续复用同一个 `AgentRuntime`，F9.5 没有创建角色专属 Runtime。

## 验证状态

F9.5a、F9.5b、F9.5c、F9.5d 均已通过独立 PR 接入 `master`。最终 F9.5d PR #9 的 Windows GitHub CI 已通过，现有 gate 包含：

```text
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

因此 F9.5 在当前开发规则下达到完成标准。

## 下一步：F9.6 Project Mailbox 与协调

F9.6 开始解决规划层尚未解决的信息流问题：Node Agent 如何把结果、阻塞和协调请求作为 Project 事实报告给 Main Agent，以及 Main Agent 如何向指定 Node 下发后续 directive，同时继续禁止 Node-to-Node 直接通信。

建议拆分为：

1. **F9.6a Mailbox Domain**：建立 ProjectMessage / MailboxStore（或等价领域服务）、消息身份、Project ownership、追加历史和读取投影；暂不触发 Agent。
2. **F9.6b Node -> Main**：Node Agent 获得受限报告 capability，支持结果、阻塞、协调请求；消息先落为 Project 事实，不在工具调用内递归唤醒 Main Agent。
3. **F9.6c Main -> Node**：Main Agent 可以向当前 Project 中指定 Node 下发 directive；NodeId 仍只是引用，工具通过 Main Binding + Project ownership 校验授权。
4. **F9.6d 协调闭环验收**：验证 Node A -> Mailbox -> Main -> Mailbox -> Node B 的受控链路，并以攻击测试证明 Node A 无法直接发送给 Node B、跨 Project 消息不可见。

F9.6 不负责长期自动调度或递归 Agent 唤醒；那属于 F9.7 ProjectRuntime 长期编排。F9.6 的核心产物是一个可记录、可追溯、权限明确的 Project 级异步通信事实层。
