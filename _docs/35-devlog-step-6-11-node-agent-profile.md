# Step 6.11 NodeAgent Profile 开发记录

## 做了什么

- 新增 `src/node/profile.ts`，把当前 Node 的能力目标、来源、教材和练习题组装为确定性的 system prompt。
- 固定 NodeAgent 可见工具为 `web_search`、教材替换和练习题集替换，并在 Profile 中声明调研、结构化提交和权限边界。
- 将 Node 内容标记为不可信数据并转义结构分隔符，保留参考答案供 NodeAgent 使用，同时要求不得向学习者逐字泄露。

## 关键决策

- Profile 每个 Turn 从权威 `NodeSnapshot` 重新生成，不把教材或题目复制进 Session 事件。
- Profile 同时返回 system prompt 和工具名白名单，但实际授权仍由 AgentRuntime、ToolService 与 NodeStore 执行。
- 不包含 NodeId、SessionId 或其他 Node 上下文，避免给模型无必要的跨边界身份信息。

## 坑与发现

- 内容面板可能含有伪造指令或闭合标签，因此不能直接作为 system prompt 指令拼接。
- 隐藏参考答案对出题和形成性反馈有用，但“默认不向学习者展示”仍需通过 Profile 约束和后续产品输出边界共同保证。

## 下一步

进入 Step 6.12，实现持续 NodeSession Service，在每次 Turn 前读取最新快照并注入 Profile 与限定工具集。
