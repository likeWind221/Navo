# Step 6.6 教材与练习内容协议开发记录

## 做了什么

- 增加 ExerciseId，以及教材、来源、题集、题目和学习者可见题集协议。
- 将教材与题集作为 NodeSnapshot 的可选当前内容，并定义两类完整替换事件。
- 为教材和题集分别增加从 1 开始的独立 revision，并在 Node projector 中严格重建。
- 提供学习者题集投影，确保公开结果不包含参考答案。

## 关键决策

- 一个 Node 当前只有一份教材和一份题集，因此不增加 MaterialId 或 ExerciseSetId；单题使用 ExerciseId 支撑后续提交与批改。
- NodeEvent revision 记录所有 Node 事实的全局顺序，内容 revision 分别记录教材和题集自己的版本。
- 内容事件保存完整新版本而非文本 patch，先保证重建确定性；大文本持久化与增量版本留到真实规模出现后决定。
- 内容只能在 Node 创建并绑定 Session 后出现，为后续按调用 Session 授权内容工具建立不变量。

## 坑与发现

- 扩展 NodeEvent 联合后必须同步扩展严格 projector，否则协议可编译但历史无法重建。
- 仅通过 TypeScript 隐藏 referenceAnswer 不足以保护运行时输出，因此增加显式学习者投影函数。
- 题集替换时需要拒绝重复 ExerciseId，否则后续按题目提交答案会产生歧义。

## 下一步

Step 6.7 实现内容替换命令，并为 AgentRuntime 增加工具白名单和 Session 来源，使结构化内容工具只能修改调用 Session 所属 Node。
