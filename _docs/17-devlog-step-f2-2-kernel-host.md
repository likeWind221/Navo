# F2.2 Backend Kernel Host 与真实模型

## 做了什么

- 新增由 Electron Main 后续启动的独立 Kernel Host，使用 stdin/stdout NDJSON 承载共享 Stream RPC v1，stdout 只写协议帧，诊断日志只写 stderr。
- 新增 Qwen/OpenAI Chat Completions SSE Adapter，把正文、reasoning、工具调用、usage 和 finish reason 翻译为后端公共 `StreamChunk`；凭据只从 Host 环境读取。
- 为 `AgentRuntime` 增加受控的 `started` 与正文 delta 观察出口，并实现 `agent.turn` Handler；桌面首版固定 `toolNames: []`。
- 新增可脚本化 Mock Host，以及 Adapter 模拟 HTTP、Handler、stdio、取消、断流和真实子进程生命周期测试。

## 关键决策

- `Kernel Host` 是进程和资源所有者，`StreamRpcServer` 只是其中的协议组件；Host 使用现有 `createApp()`，不复制 Agent 循环。
- reasoning 继续参与后端响应组装和 Session 记录，但不进入 F2.1 的正文事件。可见正文发布后若流中断，不再重试该请求，避免 UI 拼接重复前缀；尚未发布正文的瞬时失败仍沿用原重试策略。
- Qwen 请求默认显式发送 `chat_template_kwargs.enable_thinking=false`，避免本地模型只产生 reasoning 后以 `length` 结束；Host 默认限制为 8192 个输出 token，可在 1–65536 内显式调整。
- Agent 业务失败使用 `failed` 事件，传输/协议失败仍使用 RPC error；`max-tokens` 映射为 `truncated`，取消映射为 `cancelled`。

## 坑与发现

- stdin EOF 会触发 Server 收敛并取消仍在执行的请求，因此正常父进程必须保持 Host stdin 打开到应用退出。
- SSE 字节块与事件边界不一致，解析器必须保留半个 UTF-8/事件缓冲；没有 finish reason 的正常 EOF 被 Runtime 识别为断流。
- 单个 SSE 事件最多 1,048,576 个字符；跨字节块累积的未终止事件一旦超限即以安全 `TRANSPORT` 错误结束，避免损坏 Provider 无限占用内存。
- 参考 `deepseek-harness/packages/core/agent-loop/src/agent.ts` 的单一取消信号、正文 chunk 与终态收敛，以及 `deepseek-harness/packages/llm/llm-deepseek/src/{adapter,translate,serialize}.ts` 的请求快照、reasoning 分离和 HTTP/SSE 错误分类。当前 MVP 未采用 chunk 持久化、Gateway、Waterfall、多 Carrier、重连或图片能力。

## 启动与验证

- 真实 Host：`pnpm host`。配置项为 `LLM_BASE_URL`、`LLM_MODEL`、可选 `LLM_API_KEY`、`LLM_MAX_TOKENS` 和 `LLM_ENABLE_THINKING`；后两项默认分别为 `8192` 与 `false`。
- Mock Host：`pnpm host:mock`。可通过 `SKILLWORLD_MOCK_MODE`、`SKILLWORLD_MOCK_TEXT`、`SKILLWORLD_MOCK_CHUNK_CHARS` 和 `SKILLWORLD_MOCK_DELAY_MS` 编排。
- 根后端测试 23 个文件、169 项通过；共享 RPC 测试 2 个文件、11 项通过；`pnpm build` 通过。

## 下一步

前端进入 F2.3，在 Electron Main 中启动并监督 Host，建立 Client 侧 stdio Transport 和请求路由。
