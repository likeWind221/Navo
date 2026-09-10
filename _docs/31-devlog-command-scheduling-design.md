# F3.2.3 命令调度设计记录

## 做了什么

- 记录将 `/compact` 表达为 Agent Loop 工作队列中的 Command 项，而不是额外引入独立同步模块。
- 约定工作队列可承载用户消息和 Command；Agent Loop 统一消费，并根据项的 `kind` 分派到 Turn 或 Command Handler。
- 暂不实现 Command Queue、阻塞策略或 `/compact` 行为，当前只冻结设计方向。

## 关键决策

- 队列中的 Command 不伪装成 `UserMessage`，避免进入模型上下文或被写入普通用户消息历史。
- `/compact` 作为排在后续消息之前的维护 Command；当前 Turn 继续完成，空闲后消费该 Command，再处理后续消息。
- `steer()` 不承担维护屏障语义；它只用于把内容加入当前 Turn 的下一步骤。
- `AgentLoop` 持有工作队列、Command 状态和消息准入行为，不额外拆出独立同步层所有者。
- `AgentInbox` 不立即改名。Inbox 是业界常用的输入队列称呼，dsh 也使用 `Agent.inbox` 表示待处理用户输入；本项目可保留该名称，在需要承载 Command 时通过队列项联合类型表达范围。

## 坑与发现

- dsh 的 `CommandRuntime` 本身不提供通用 Command Queue；它负责注册、解析和直接调用 Handler。dsh 的 Agent Loop 只拥有用户消息 Inbox、Turn phase 和 `runMaintenance()`。
- dsh 的 `/compact` 通过 `compactNow()` 调用 `runMaintenance()`，Agent 忙时返回 busy，并不会等待当前 Turn；等待型维护 Command 是本项目的扩展语义。
- 如果同时支持 sidecar Command（例如 Turn 运行期间立即返回 `/hello`），单纯把所有 Command 放在队列头部会使其等待当前 Turn，需要在工作项中区分 `queued` 与 `sidecar`。

## 下一步

- F3.2.3 实现前先确定后续消息在维护 Command 等待期间采用“暂存后继续”还是“立即返回 session-busy”。
- 确定消息队列与 Command FIFO 的插入顺序后，再实现 Agent Loop 的统一工作项消费。
