# Step 6.8 Node 内容行为测试开发记录

## 做了什么

- 验证教材和题集独立 revision、ExerciseId 保留/生成及完整事件重建。
- 验证未绑定 Node、空内容、空题集、重复 ExerciseId 和损坏内容 revision 被拒绝且不留下事件。
- 验证学习者题集不含参考答案，而专用工具只返回 revision 和题目数量。
- 验证 Session 来源授权、跨 Node 隔离、工具白名单、取消、卸载及 AgentRuntime 透传。

## 关键决策

- Store、直接工具调用和完整 AgentRuntime 调用分层验证，避免只证明某个局部函数。
- 通过两个绑定不同 Session 的 Node 证明写入目标来自真实 Session，而不是模型参数。
- 取消场景在执行前终止 signal，并断言没有内容事件提交。

## 坑与发现

- NodeSnapshot 内部实体位于 `snapshot.node`；共享测试 helper 采用扁平返回快照和确定 SessionId，避免嵌套命名混淆。
- 参考答案仍会保存在完整领域快照中，脱敏边界必须使用 learner view；测试不把完整快照当作前端公开值。
- 当前测试没有文件持久化场景，教材和题集仍以 NodeEvent 内存事实重建。

## 下一步

Step 6.9 实现 Provider-neutral Search Service、Mock Adapter 和 Agent 搜索工具。
