# Step 6.3.1 双 Workspace Session 与功能切片修正

> 后续修正：真实 UI 场景表明教材与练习是同一对话中的内容面板，双 Session 假设已由 [Step 6.3.2](14-devlog-step-6-3-2-node-content.md) 撤销。

## 做了什么

- 将每个 Node 改为 LearnSession 与 PracticeSession 两条隔离会话，工作区内部持续、工作区之间不共享原始日志。
- 将 `session-bound` 改为带 workspace 的 `workspace-session-bound`。
- 从当前代码撤回尚无功能支撑的 PracticeAttempt、Evidence、mastery 和 prerequisite proposal 协议。
- 把阶段 6 重排为“搜索调研 → 纯文字教材 → 多轮答疑”的 Learn Workspace MVP。

## 关键决策

- NodeEvent 只进入 Learning Store，SessionEvent 只进入 Session Store。
- 跨 workspace 信息以后通过明确领域产物受控共享，不直接读取另一条 SessionLog。
- 当前只保留 `NodeId`；PracticeAttemptId 和 EvidenceId 等对应功能出现后再设计。
- 第一版教材仍是 LearnSession 的最终 assistant 文本；是否升级为 Artifact 留到 Practice 真正需要共享教材时决定。

## 坑与发现

- 先按完整领域横向设计会让未验证的类型和事件快速固化，却迟迟没有可运行功能。
- Harness 的独立 Agent Session 证明隔离历史有利于权限与生命周期，但 SkillWorld 暂不引入 Agent Team、Session fork 或 Agent 间通信。
- Search 先提供可替换协议和 Mock；真实平台没有统一 HTTP 协议，需要在完成 MVP 后单独选择 Adapter。

## 下一步

Step 6.4 只实现 Learn MVP 需要的 Node Store、双 workspace 绑定、learn 状态与事件投影。
