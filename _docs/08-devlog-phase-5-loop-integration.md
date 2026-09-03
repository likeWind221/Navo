# 阶段 5.2 闭环集成测试开发记录

## 完成什么

新增 `tests/integration.spec.ts`，从 `createApp()` 公开入口驱动一次完整的“用户输入 → 模型调用工具 → 工具返回 → 模型最终回答”闭环，不再手工装配核心 Service。

## 关键设计

- Mock LLM Adapter 与 echo 工具通过声明 `llm`、`tools` 依赖的 Cordis 测试插件注册，测试结束随根 Context 一并释放。
- 第一次模型响应生成工具调用，Runtime 执行工具后发起第二次模型请求，第二次响应结束 Turn。
- 精确验证两次模型请求：首次只含用户消息；第二次含用户消息、Assistant 工具调用与 Tool Result；两次请求使用同一工具 Schema。
- 精确验证从 `turn-started` 到 `turn-ended` 的 13 个 Session 事件，并核对两个 `llm-requested` 快照与 Adapter 实际收到的消息一致。
- 通过 `deriveMessages()` 从 Session Surface 重建用户、工具调用、工具结果和最终回答四条模型可见消息。

## 差异与取舍

测试沿用 DeepSeek Harness 从完整 Cordis Bundle 的公开 Service API 驱动闭环的方式。当前范围只接入确定性的内存 Mock 和单个工具，不引入 Provider SDK、持久化、Goal、Job、Workspace、DAG 或 Node 调度。

## 验证

- `pnpm typecheck` 通过。
- 新增集成测试单独运行通过：1 个测试文件、1 项测试。
- 完整回归通过：13 个测试文件、86 项测试全部通过。
- `tests/integration.spec.ts` 不足 150 行，符合单文件不超过 300 行的约束。

## 下一步

进入步骤 5.3，定义最小 NodeAgent 调用边界，将节点描述转换为一次 AgentRuntime Turn，不在该层实现 DAG、证据或验证逻辑。
