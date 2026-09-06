# Step 6.12 持续 NodeSession Service 开发记录

## 做了什么

- 新增 `ctx.nodeSessions`，提供 `startLearning`、`sendMessage` 和 `stop` 三个 Node-scoped 入口。
- 首次开始时创建并绑定唯一 Session，后续消息复用该 Session；每个 Turn 执行前读取最新 Node 快照并生成 Profile。
- 将 Profile 的 system prompt 与工具白名单交给 AgentRuntime，Service 不直接写 SessionLog，也不复制模型循环。
- 增加瞬态 FIFO admission chain、当前 Turn 取消句柄和卸载取消，保证 stop 不误伤排队中的后续消息。

## 关键决策

- NodeSession 继续使用通用 SessionId 和 AgentRuntime，不建立第二套持久化 Session 协议。
- Service 的瞬态 Promise 链只解决“当前 Turn”精确取消与 Profile 执行时刷新；AgentRuntime 仍保留通用 Session 单写者保护。
- 模型路由由可信 Service 配置统一提供，调用者不能逐消息扩大工具集或伪造 system prompt。

## 坑与发现

- 若所有 Turn 直接同时送入 AgentRuntime，外层 Service 无法在两个 Turn 交接的微任务窗口准确判断当前取消目标，因此需要一层不持久化的顺序 admission。
- 空消息必须在首次 Session 绑定前拒绝，否则无效调用会留下已绑定但没有有效 Turn 的 Node。

## 下一步

进入 Step 6.13，为持续上下文、Profile 刷新、Node 隔离、FIFO、取消恢复、失败和卸载补齐行为测试。
