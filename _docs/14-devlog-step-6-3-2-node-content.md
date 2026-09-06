# Step 6.3.2 单 NodeSession 与内容面板修正

## 做了什么

- 将每个 Node 收敛为一个持续 NodeSession，教材与练习题改为同一对话可编辑的领域内容面板。
- 将练习批改定义为无状态 LLM 调用，不加载或延续 NodeSession 记忆。
- 当前类型和事件再次收缩为 Node、`node-created` 与 `session-bound`。
- 把阶段 6 重排为“搜索 → 教材 → 练习题 → 对话修改”的纵向功能闭环。

## 关键决策

- NodeSession 保存对话记忆；教材、题目和隐藏参考答案由 Node 领域状态保存。
- NodeAgent 更新内容必须使用结构化领域操作，不能解析 assistant 自然语言。
- 每次 NodeAgent 调用可以加载教材和题集的最新快照；不同 NodeSession 仍然隔离。
- Grader 未来只接收题目、参考答案和学习者答案，不作为长期 Agent，也不参与 NodeAgent 对话。

## 坑与发现

- “learn/practice workspace”此前被误解为两个对话模式；真实界面中它们是同时可见、可共同修改的内容区域。
- Harness 的持续 Session 适合作为 NodeAgent 记忆，但结构化教材和题目不应只存在于 Session 消息中。
- 当前 ToolExecutionContext 没有 Session 来源。内容工具必须先建立调用来源或等价能力约束，不能只相信模型传入的 NodeId。

## 下一步

Step 6.4 实现独立 Node Store、单 NodeSession 一对一绑定和严格事件投影，不提前实现教材与题目。
