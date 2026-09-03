# 阶段 5.1 最小组合入口开发记录

## 完成什么

新增 `src/app.ts`，提供 `SkillWorldApp` Cordis 组合插件和异步 `createApp()` 工厂。组合入口统一挂载 Session、LLM 与 Tools，并在依赖就绪后激活 AgentRuntime。

## 关键设计

- AgentRuntime 通过 `ctx.inject(["sessions", "llm", "tools"], ...)` 激活，不依赖手工装配顺序。
- Adapter 与业务工具不属于核心应用入口，继续由外部插件按需注册。
- `createApp()` 只在组合插件完全就绪后返回 Context；启动失败时先释放根 Fiber，再向调用方传播错误。
- 所有子插件归属应用 Fiber。释放根 Context 会统一撤销 AgentRuntime、三个核心 Service 以及各自作用域中的注册项。
- Runtime 配置只透传现有安全限制，不在组合层复制业务逻辑。

## 差异与取舍

沿用 DeepSeek Harness 的 Cordis Service、显式依赖注入和 Fiber 生命周期边界，但当前最小闭环不引入 Loader、持久化、Provider 注册表或 Node 调度设施。完整的“用户输入 → 模型 → 工具 → 最终回答”业务流留给步骤 5.2 验证。

## 验证

- `pnpm typecheck` 通过。
- `pnpm test` 通过：12 个测试文件、85 项测试全部通过。
- 生命周期探针确认创建后 `sessions`、`llm`、`tools`、`agentRuntime` 均可用；释放根 Fiber 后四项均已撤销。
- `src/app.ts` 不足 50 行，符合单文件不超过 300 行的约束。

## 下一步

进入步骤 5.2，新增闭环集成测试，验证两次模型请求、一次工具执行以及完整 Session 事件序列和消息重建。
