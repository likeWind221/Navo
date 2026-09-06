# Step 6.7 Node 内容 Store 与受限工具开发记录

## 做了什么

- 为 LearningStore 增加教材和题集完整替换命令，由系统分配内容 revision 与缺省 ExerciseId。
- 注册教材/题集结构化工具，按 AgentRuntime 提供的真实 SessionId 反查并修改所属 Node。
- 为 Turn 增加工具白名单，模型请求只展示允许的 Schema，执行时再次拒绝越权工具。
- 内容工具只返回 revision 和题目数量，不向 tool result 复制参考答案。

## 关键决策

- 模型参数不携带 NodeId，内容写权限完全由真实调用 Session 的绑定关系决定。
- 未指定 toolNames 保持现有 Runtime 的全工具行为；NodeSession 后续必须显式传入白名单。
- AgentRuntime 在 Turn 开始时复制并冻结白名单，避免调用者在异步执行中改变权限。
- 内容替换同步完成且先完整校验，失败不会提交半成品事件。

## 坑与发现

- Harness 使用完整 Agent scope 管理工具可见性和归属；当前项目只需要 per-turn allowlist 与 Session provenance，因此没有引入 Scope 子系统。
- 仅过滤模型可见 Schema 不足以形成权限边界，模型仍可能生成未展示的工具名，所以执行阶段必须再次检查。
- ToolExecutionContext 原本只有 callId 和 signal；若没有 Session 来源，领域工具只能相信模型提供的 NodeId，无法阻止跨 Node 写入。

## 下一步

Step 6.8 为内容替换、严格重建、工具白名单、Session 授权、隐藏答案、取消和卸载补充行为测试。
