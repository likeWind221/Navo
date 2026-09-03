# 当前版本收口记录

## 完成什么

当前版本在步骤 5.2 收口：提供商无关协议、Session 日志与 Surface、流式 LLM、工具服务、AgentRuntime、按 Session 串行的内部 Turn Inbox、Cordis 应用组合及模型—工具—模型闭环均已实现并通过验收。

本次收口同时纳入流式增量块组装、错误事件归档、截断工具调用配对、Session 观察者故障隔离等稳健性修正。

## Node 延期决策

原计划 5.3 将节点描述包装为一次 `AgentRuntime.runTurn()`。评审后确认该抽象过早：Node 应拥有持续 Session 生命周期，可能接收多轮消息并与后续 DAG、Evidence、Verification 状态协作，不应等同于单个 Turn。

现有 `AgentInbox` 只负责同一 Session 内完整 Turn 的 FIFO 串行执行，不是供 Node 或用户向运行中会话投递消息的公开 Inbox。因此 5.3 与 5.4 标记为延期，未创建占位实现或测试。

## 后续前置设计

- 定义 Session-scoped Agent 的创建、恢复、停止与结果边界。
- 定义公开消息 Inbox 及 next-turn、next-step、取消语义。
- 定义 Node、DAG、Evidence 与 Verification 的领域状态和持久化归属。
- 完成上述边界后重新规划 Node 执行器，不修改内层 AgentRuntime 的提供商无关协议。

## 验证基线

- `pnpm typecheck` 通过。
- `pnpm test` 通过：13 个测试文件、86 项测试全部通过。
- 5.2 集成测试确认两次模型请求、一次工具执行、完整 Session 事件序列及上下文重建。
