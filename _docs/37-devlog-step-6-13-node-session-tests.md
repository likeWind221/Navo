# Step 6.13 NodeSession 行为测试开发记录

## 做了什么

- 新增 `tests/node.spec.ts`，通过完整后端组合验证 NodeSession Service，而不是绕过 Runtime 或 Store 单测私有实现。
- 覆盖单 Session 创建与复用、持续上下文、Profile 确定性和转义、内容工具更新后的 Profile 刷新、Node 隔离与限定工具集。
- 覆盖同 Node FIFO、不同 Node 独立运行、停止当前 Turn 后继续、模型失败日志闭合、无效入口和 Service 卸载。

## 关键决策

- 测试使用 Mock LLM 与 Mock Search，既不读取真实密钥也不访问网络。
- FIFO 通过阻塞首个模型请求并观察第二个请求尚未开始验证；取消通过“活动 Turn + 排队 Turn”确认只影响当前项。
- 卸载测试同时断言活动项收敛为 cancelled、排队项以稳定 NodeError 拒绝以及 Cordis Service 被移除。

## 坑与发现

- ToolService 按注册顺序返回允许工具，而不是按白名单数组排序，因此能力集合测试不能错误依赖展示顺序。
- Profile 只在一个 Turn 开始时生成；结构化工具在该 Turn 内更新内容后，下一 Turn 才重新注入最新快照。

## 下一步

进入 Step 6.14，把 NodeStore、内容工具、Search 和 NodeSession Service 接入默认应用组合。
