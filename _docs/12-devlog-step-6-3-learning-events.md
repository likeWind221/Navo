# Step 6.3 学习领域事件协议开发记录

> 后续修正：六类首版事件已在 [Step 6.3.1](13-devlog-step-6-3-1-workspace-sessions.md) 收缩为 Learn MVP 所需的三类事实。

## 做了什么

- 定义带 `EventId`、`NodeId`、revision 和时间戳的 `NodeEvent` 信封。
- 增加 Node 创建、Session 绑定、learn 状态变化、练习尝试、mastery 变化和前置缺口提议六类事实。
- PracticeAttempt 只记录尝试身份和 Evidence，不复制或定位对话正文。
- 前置缺口只能表达为 proposal，不能直接创建 Node 或修改 DAG。

## 关键决策

- Node 事件与 SessionEvent 完全分流；领域历史不会写入 SessionLog 或进入模型消息 Surface。
- 只有 `session-bound` 保存 Node–Session 绑定；其他 NodeEvent 不依赖 Session 或 Turn。
- `node-created` 保存能力目标和来源，三个状态轴由后续投影建立确定初值。
- 状态变化事件只携带其负责轴的完整新状态，不复制整个 Node。
- mastery payload 复用 `MasteryState`，继续要求正式结论至少关联一个 Evidence。
- 对话来源若未来确有需求，应由 Evidence 或专门关联协议负责，而不是提前污染所有 NodeEvent。

## 坑与发现

- Harness Agent Team 把领域事实写入 Lead Session，并在 append 后 flush，再发布变化；它还用 task revision 检查连续性。
- SkillWorld 的 Node 身份独立于 Session，因此采用独立 NodeEvent 流；提交、连续性和观察者语义留给 6.4 Store。
- 初版曾让练习和缺口事件携带 Session/Turn 定位，但这会把领域状态绑定到 AgentRuntime；评审后已删除，待真实 Evidence 功能出现再决定关联方式。
- 本阶段没有持久化格式，暂不增加 schema version，避免承诺尚未存在的迁移协议。

## 下一步

Step 6.4 实现内存 Learning Store、合法转换校验，以及从完整 NodeEvent 历史重建 Node 快照。
