# Step 6.2 学习领域身份与协议开发记录

> 后续修正：未被 Learn 功能验证的 PracticeAttempt、Evidence 与 mastery 协议已在 [Step 6.3.1](13-devlog-step-6-3-1-workspace-sessions.md) 回撤。

## 做了什么

- 新增 `NodeId`、`PracticeAttemptId`、`EvidenceId` 及非空构造函数。
- 定义 `Node`、能力目标、来源引用和 `NodeWorkspace`。
- 将 `learn`、`practice`、`mastery` 建模为三条独立状态轴。
- 按产品修订删除预设的 Lesson 实体，统一使用 Node 术语。

## 关键决策

- `NodeId` 与 `SessionId` 分离：Node 是能力实体，Session 是对话载体。
- 每个 Node 只有一个 learn workspace 和一个 practice workspace，因此不创建 `LearnId` 或 `PracticeId`。
- 练习尝试和证据存在独立关联生命周期，保留各自品牌 ID。
- Source 当前只是外部引用，不提前创建 `SourceId`；教材、题目和评卷身份推迟到对应实体出现时。
- 三条状态轴不相互推导；practice 不设置“完成”状态，mastery 由 Evidence 引用表达。

## 坑与发现

- Harness 由拥有身份的 package 定义品牌，并将 Session 身份与一次 Subagent run 身份分开；当前实现沿用这种“按生命周期区分身份”的原则。
- Harness Agent 直接使用 `SessionId`，但 SkillWorld 的 Node 必须在 Session 迁移或恢复后保持独立领域身份，因此不照搬该等同关系。
- 把 learn/practice 叫工作区比叫线性模式更准确，但每条 Node 消息仍只面向其中一个工作区。

## 下一步

Step 6.3 将这些类型用于学习领域事件；不会把 Session 对话正文复制进领域事件。
