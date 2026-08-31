# 阶段 2 SessionLog 与上下文投影开发记录

## 做了什么

- 建立 `src/session/types.ts`：定义 `SessionEvent`、公共 `EventRecord`、模型可见的 `MessageEvent` 和仅供生命周期/审计的 `LogOnlyEvent`。
- 建立 `src/session/store.ts`：提供 Cordis `ctx.sessions`、`append()`、`getEvents()` 和提交后发布的 `session/event`。
- 建立 `src/session/projector.ts`：从完整 SessionLog 确定性投影模型 `Message[]`。
- 增加 Session Store 与 Message Projector 测试，覆盖顺序、不可变性、生命周期、可见边界、reasoning、多工具结果和日志重建。
- 命名统一为 Harness 风格：基础 ID 位于 `src/brand/ids.ts`，会话事实层使用 Session/SessionStore/SessionEvent 表述。

## 关键决策

- Session 单向依赖稳定的 LLM Message 协议，不依赖具体 Provider 或 DAG 领域类型。
- `UserMessageEvent`、`AssistantMessageEvent`、`ToolCallResultEvent` 统一在 `data.message` 保存完整 Message；Projector 只筛选和提取，不补造 ID、role 或内容。
- Store 分配 Event ID、会话内 sequence 和 ISO 时间戳；提交时深拷贝并深冻结，先写入日志再发布事件。
- Projector 当前顺序遍历完整日志；增量投影缓存留作后续优化，且必须可由权威日志重建。

## 坑与发现

- `ToolResultMessage` 使用 `user` role，并通过单元素 `tool-result` 内容块保留工具语义和 `toolCallId` 关联。
- reasoning 是 assistant message 内与 tool call 平级的 ContentBlock：完整保留，但不参与 AgentLoop 控制。
- 两个 Session 的测试是证明 sequence 属于会话内顺序的必要证据；在事件监听器内立即读取日志可证明“先提交、后发布”。

## 下一步

进入阶段 3 的步骤 3.1：设计并实现 Provider-neutral LLM Service。
