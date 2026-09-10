# F3.2.4 Mock Host 与端到端回归

## 做了什么

- Mock Host 现在装配真实 `createApp()`、`MockLLMAdapter`、`agent.turn.v2` 和 `session.command.v1`，旧版 `agent.turn` 场景继续保留。
- Host 进程测试通过子进程 stdin/stdout 接入 `StreamRpcClient`，验证回合事件、命令事件、身份关联和终态。
- 增加确定性的模型完成、挂起和失败场景；覆盖回合取消、stdin EOF、SIGTERM 和崩溃回归。
- `/hello` 通过真实 `CommandService` 在独立进程完成，未触发模型流。

```text
StreamRpcClient
      |
child stdin --> StdioRpcServerTransport --> StreamRpcRouter
                                             |
                         +-------------------+-------------------+
                         |                                       |
                  agent.turn.v2                         session.command.v1
                         |                                       |
                  AgentRuntime + MockLLM                    CommandService
                         |                                       |
child stdout <-- NDJSON item/end/error frames <---------------+
      |
      +--> identity/order/terminal/cancel assertions
```

## 关键决策

- 复用现有 `scripts/host/mock.ts` 与 `tests/host/process.spec.ts`，让进程边界回归与既有 Host 生命周期测试保持在同一职责内。
- Mock LLM 只提供本 Step 所需的完成、挂起和失败脚本，不引入真实网络或新的 RPC 契约。
- 客户端测试直接使用 `StreamRpcClient`，因此同时覆盖请求取消、服务端 cancel 帧和 stdout 帧解析。

## 坑与发现

- 旧 Mock Host 只注册 `agent.turn`，即使内存级 RPC 测试通过，也无法证明新命令流已经进入真实 stdio 进程。
- 进程退出前必须先关闭 RPC 输入并等待服务端 drain，否则取消测试可能留下未完成的子进程。
- DeepSeek Harness 的 `packages/sdk/protocol/src/transport.ts` 采用换行 JSON 流并跳过坏行，`packages/client/connection/src/rpc.ts` 在客户端取消时立即释放待处理请求；本项目保留自己的 `open/item/end/error/cancel` 流协议，并由 `StreamRpcClient` 实现同样的本地取消语义。

## 下一步

- F3.2 已完成，前端可进入 F3.3，基于冻结的回合与命令协议接入消费状态。
- `/compact`、命令持久化、命令发现和跨会话排序仍需独立规划。
