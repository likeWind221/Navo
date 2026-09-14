# F3.2.3 会话命令流与 `/hello`

## 做了什么

- 新增内核 `CommandService`，提供命令注册、参数校验、旁路执行和会话排队执行。
- 实现 `/hello` 旁路命令：不调用模型，不进入 AgentLoop，直接输出 `CommandEvent`。
- 为命令事件增加 `command-started`、`command-completed`、`command-failed`、`command-cancelled` 四种统一事件，并复用 RPC 帧封装。
- 为命令记录活动回合、最近回合或空会话锚点，前端可将旁路反馈放置在对应回合下。
- Host 注册 `session.command.v1`，接收命令输入并流式返回命令事件；`agent.turn.v2` 明确只接受回合事件。
- AgentInbox 支持同一会话的排队命令优先于后续 Turn，队列中的命令可在执行前取消。

```text
Frontend command input
        |
        v
session.command.v1 RPC input
        |
        v
Kernel Host command handler
        |
        v
CommandService -- resolve anchor --> active turn / last turn / session
        |
        +---------------------- sidecar: hello ----------------------+
        |                                                             |
        |                                                             v
        |                                                  CommandEvent stream
        |
        +---------------------- queued command -----------------------+
                                      |
                                      v
                         AgentInbox per-session work queue
                                      |
                                      v
                             Command handler execution
                                      |
                                      v
                            CommandEvent terminal result
```

## 关键决策

- `CommandEvent` 是共享 `TurnEvent` 联合类型的一部分，因此仍使用同一套 JSON/RPC 帧解析；命令流的方法输出类型单独限制为 CommandEvent，避免命令事件混入 `agent.turn.v2` 的回合状态机。
- `session.command.v1` 已切换为 CommandEvent 输出；旧的通用通知解析器仅保留兼容导出，不再参与命令 Host 路径。
- `commandId` 表示一次命令调用，`requestId` 仍表示外部回合请求；命令事件不复制 `requestId`，而通过 `anchor` 关联 UI 展示位置。
- 命令锚点在命令接纳时确定：活动回合优先，其次是最近已结束回合，没有历史时使用会话锚点，不创建虚构的空回合。
- `/hello` 采用 sidecar 路径；未来需要改变会话或等待 AgentLoop 的命令再使用 queued 路径，当前不实现压缩等业务命令。
- 参考 DeepSeek Harness 的 `packages/interaction/commands/src/index.ts` 注册与直接执行职责，以及 `packages/compaction/command-compact/src/index.ts` 由命令处理器调用领域 Service 的方式；本项目暂不引入 scoped registry、持久化 command/run 事件和图片参数，保持 F3.2.3 的最小范围。

## 坑与发现

- 排队测试最初在首个 Turn 真正取到模型脚本前就取消，导致第二个 Turn 复用了首个挂起脚本；等待首个模型请求被记录后再取消，才能稳定验证命令优先级。
- 旁路命令与回合流是两个独立 RPC 请求，`anchor` 只提供 UI 归属，不承诺跨流的全局到达顺序。
- 命令输出终态由 RPC Validator 约束为一次；失败或取消可以在 started 之前发生，成功必须先有 started。

## 下一步

- F3.2.4 补齐 Mock Host 与端到端脚本，验证命令流在独立进程、stdio 和前端消费路径中的完整生命周期。
- 后续再实现 `compact` 等 queued 命令，由命令处理器调用 AgentRuntime 暴露的状态接口；本步不改变会话压缩策略。
