# Step 6.1 学习产品契约收敛开发记录

> 后续修正：双 WorkspaceSession 与功能切片方案见 [Step 6.3.1](13-devlog-step-6-3-1-workspace-sessions.md)。

## 做了什么

- 将首个应用明确为“技能学习 Agent”。
- 定义 Node、MainSession、NodeSession，以及可自由切换的 `learn` / `practice` 工作区。
- 固定 Main Agent、NodeAgent 与后续 Verification 的权限边界。
- 记录当前不拆分长期 Tutor / Assessor Agent 的决定。

## 关键决策

- Node 是可验证能力单元，不等同于章节、Session、Turn 或具体 DAG 节点实现。
- 一个 Node 持续绑定一个独立 Session；工作区切换共享历史且不蕴含任何完成状态。
- Main Agent 管全局规划，NodeAgent 管节点内交互；跨节点变化只通过领域事实或 proposal 提交。
- mastery 必须由后续 Verification 基于 Evidence 判定，不能由 NodeAgent 自评。

## 坑与发现

- Harness 的 Agent 以 Session 为身份，并让子 Agent 继承父级的确定组合，同时叠加 persona、tool restriction 和 delegation policy；其 durable Inbox 也能从 Session 事件恢复。
- SkillWorld NodeAgent 不是一次性 Subagent：它围绕能力节点长期存在，不 fork MainSession 历史，也不与其他 NodeAgent 直接通信。
- 过早拆分 Tutor / Assessor 会引入双上下文同步，却尚不能提供真正独立的验证保证。

## 下一步

进入 Step 6.2，把本契约落实为品牌化身份和学习领域协议；暂不实现事件存储、NodeSession Service、教材生成或评卷。
