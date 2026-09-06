# F2.1 通用 Stream RPC MVP

## 做了什么

- 新增共享 `rpc/` 包，提供版本 1 的 open/item/end/error/cancel 协议、严格运行时校验、StreamRpcClient、StreamRpcServer、StreamRpcRouter 与 NDJSON 增量分帧。
- 新增唯一业务契约 `agent.turn`：输入 sessionId/requestId/text，输出 started、text-delta 及 completed/cancelled/failed/truncated 终态。
- 新增共享 RPC 独立 TypeScript 配置和 8 个协议/生命周期测试；没有修改前后端包清单或锁文件。

## 关键决策

- RPC 核心不依赖 Electron、React、Cordis 或模型；stdio 仅是后续第一个 Transport。
- 第一版只支持请求对应流式响应，不做 unary、snapshot、重连、工具或 reasoning；Agent 流要求 started 开头且恰好一个业务终态。
- 可序列化 RpcFailure 与可抛出 RpcError 分文件；双方校验精确字段、版本、JSON-safe 数据、尺寸与业务输出顺序。

## 坑与发现

- NDJSON 不能假设一个 data chunk 对应一帧，因此覆盖半行、多行及 finish 残留；单帧上限 1,048,576 字符。
- Client 取消后立即结束本地迭代并忽略迟到帧，同时向 Server 发送 cancel；Server 将其转换为 Handler 的 AbortSignal。
- 根项目原有 19 个测试文件共 150 项通过；RPC 独立 2 个测试文件共 8 项通过；所有手写 RPC 文件低于 300 行。

## 下一步

交给后端 Agent 规划 F2.2：实现 Kernel Host、真实 Qwen Adapter 和 agent.turn Handler；共享契约确认后不得由两端并发修改。
