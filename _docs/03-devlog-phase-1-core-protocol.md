# 03 - 阶段 1 核心协议开发记录

## 做了什么

- 完成品牌化 ID、LLM 消息协议、编译期协议断言和运行时协议样例。
- 新增 `src/brand/ids.ts`：定义 `SessionId`、`MessageId`、`EventId`、`ToolCallId`、`TurnId`、`StepId` 及构造函数。
- 新增 `src/llm/types.ts`：定义 Provider-neutral 的消息、内容块、工具 Schema、结束原因、用量、失败信息和生成请求/响应。
- 新增 `tests/llm-types.typecheck.ts`：验证 ID 不可混用、工具调用/结果关联、assistant 响应角色与 error 结束原因边界。
- 新增 `tests/llm-types.spec.ts`：验证 ID 运行时字符串表示、空 ID 拒绝，以及包含 reasoning、tool call/result 的协议 JSON 往返。
- 新增 `vitest.config.ts`：限制测试发现范围为 `tests/**/*.spec.ts`，避免运行只读参考目录中的测试。

## 关键决策

- ID 在 TypeScript 中使用 `unique symbol` 品牌字段隔离类型，运行时仍为可序列化字符串；构造函数拒绝空字符串但不负责生成随机 ID。
- canonical message protocol 只使用 `system`、`user`、`assistant` role；在基础 `Message` 上细分 `UserMessage`、`AssistantMessage` 和 `ToolResultMessage`。工具结果仍使用 `user` role，并由单元素 `tool-result` 内容块保留调用关联，Adapter 再转换为各 Provider 的 wire format。
- 工具调用参数保留模型输出的原始 JSON 字符串，后续由 Tools Service 解析和校验。
- `reasoning` 允许记录，但不参与 AgentLoop 的循环或终止判断。
- 类型边界和运行时行为拆分测试：前者由 `pnpm typecheck` 检查，后者由 Vitest 执行。

## 坑与发现

- `satisfies` 保留对象字面量的具体类型；验证可赋值给含只读数组的协议类型时，使用 `toMatchTypeOf` 而非完全相等断言。
- 未固定 Vitest 的 `include` 时，它会扫描项目根目录下的 DeepSeek Harness 参考测试；配置正向包含范围可避免误执行。
- `AbortSignal` 是单次请求的运行控制字段，不是 JSON 协议载荷，不应出现在序列化样例中。

## 下一步

- 进入步骤 2.1：定义会话事件协议。
