# 180：DeepSeek Flash 后端接入

日期：2026-10-28。范围：后端生成模型、正式 Host 和已有真实验收入口。当前已授权实施代码，真实 API 调用另报预算后执行。

## 做了什么

- 新增 `src/llm/adapters/deepseek.ts`，复用 Chat Completions 序列化和 SSE 协议，发送 DeepSeek thinking 参数；思考模式默认开启、effort 默认为 high。读取 reasoning_content，并通过已有消息历史在工具后续请求中回传。
- `src/host/config.ts` / `main.ts` 增加 deepseek 分支，Main / Node / Review 复用既有模型配置；图谱仍须明确提供 GRAPH_PROVIDER 和 GRAPH_MODEL。
- `scripts/acceptance.ts` 在 LLM_PROVIDER=deepseek 时选择 Flash；其余情况保留原 ChatGPT 订阅验收默认。subscription.ts 继续明确验证订阅认证。
- Qwen 的 HTTP 错误分类、有限响应体读取和连接校验原样提取到 protocols/completions/http.ts，两适配器复用；Qwen 的请求参数和 reasoning 字段不变。

## 配置

```powershell
$env:LLM_PROVIDER='deepseek'
$env:LLM_MODEL='deepseek-flash'
# DEEPSEEK_API_KEY 由用户在本机环境配置，不写入仓库。
$env:LLM_MAX_TOKENS='8192'
$env:LLM_ENABLE_THINKING='true'
# 可选图谱：
$env:GRAPH_PROVIDER='deepseek'
$env:GRAPH_MODEL='deepseek-flash'
```

默认地址 https://api.deepseek.com；LLM_API_KEY 优先于 DEEPSEEK_API_KEY。图谱 GRAPH_API_KEY 优先，相同地址可复用 Main 密钥，否则读取 DEEPSEEK_API_KEY；不会将自定义 Main 地址的独立 LLM_API_KEY 传给其他地址。LLM_ACCOUNT_ID 不用于 DeepSeek。输出沿用 Host 1–65536 的现有预算边界，图谱输出受 GRAPH_OUTPUT_TOKEN_LIMIT 限制。Embedding 独立配置，本次未新增 DeepSeek Embedding。

## 关键决策

工具的选择、执行和运行取消仍归现有 Runtime 所有；适配器只转换协议，不增加模型重试。stream 直接传递 AbortSignal；HTTP 错误映射为 AUTH / RATE_LIMIT / SERVER / INVALID_REQUEST / CONTEXT_WINDOW_EXCEEDED，错误信息不复制服务响应正文。图谱以 deepseek 记录兼容提供方，内部 graph:deepseek 仅作路由。

后续评测显式设置 LLM_PROVIDER=deepseek；没有配置时不会静默把旧订阅验收切走。规则判分仍由现有验收脚本负责，本次未实现 LLM 裁判或指标评测集。模型别名会更新，未来正式报告须记录时间、模型配置和服务实际版本。

配置文件 269 行，仍集中负责同一启动配置边界；未超过 300 行。独立适配器和公共 HTTP 边界有两个真实消费者；未引入仅转发文件、依赖或前端修改。

## 坑与发现

系统默认 Node 为 22，第一次类型检查暴露订阅专用脚本对联合类型未缩窄；已显式固定订阅提供方。新测试初次使用错误 Message ID / tool message 类型，已按现有内部协议修正；不修改生产消息协议。正式验证使用 bundled Node 24，PATH 首项为 Windows System32。

## 验证结果与边界

- 类型检查通过；适配器、Host 配置与验收选择专项 5 文件 / 40 项通过。
- bundled Node 24：`NAVO_TEST_MODE=all pnpm test --maxWorkers=4`，183 文件 / 1138 项全部通过，352.04 秒；日志 `%TEMP%/navo-deepseek-full.log`。`git diff --check` 通过。PR 当前 head CI 待收口追加。
- 测试使用受控 HTTP / SSE；真实 DeepSeek、GPU 和外部生成调用为 0。未证明真实服务兼容性、长任务质量、线上性能或评分有效性。
- 官方接口参考：[首次调用](https://api-docs.deepseek.com/quick_start/agent_integrations/)、[思考与工具续传](https://api-docs.deepseek.com/guides/thinking_mode/)。本次依据 API 协议实现，未引用或照搬 DeepSeek Harness 源码。

## 下一步

在独立临时数据库安排有预算的真实协议 smoke，再决定完整任务与指标评测；失败保留现场。当前 F14.6 等后续 Step 不在本次授权内。最终交付提供模块地图与代码导读。
