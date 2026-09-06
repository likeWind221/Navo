# Step 7.2 FetchCore 与校验边界开发记录

## 做了什么

- 新增 `src/tools/builtins/fetch/core.ts`，实现不继承 Cordis Service 的内部 FetchCore。
- FetchCore 构造时接收匿名底层读取函数和可信配置，一次 `fetch()` 调用独立拥有 AbortController、deadline、timer 与监听器。
- 新增 `src/tools/builtins/fetch/validation.ts`，规范化 URL 请求，校验最终 URL、HTTP 状态和正文联合类型，并截断、复制、冻结结果。
- 未知底层异常统一收敛为不泄露 cause 的 `network-failed`；已经分类的 FetchError 保持原错误码和安全模型消息。

## 关键决策

- 底层读取函数是 FetchCore 的匿名构造依赖，不命名为 Adapter、Provider 或 Cordis Service，也不注册 Context 属性。
- 默认超时为 30 秒，最大 5 分钟；默认正文预算为 100,000 字符，可信配置最大允许 1,000,000 字符。
- 请求与返回 URL 的基础长度上限为 2,048；HTTP(S)、内网地址和连接目标等完整网络策略继续由 7.3 负责。

## 坑与发现

- 取消必须在请求校验和底层调用前检查，避免预取消请求启动任何外部副作用。
- 底层 Promise 即使在超时或取消后才拒绝也必须挂接处理器，避免迟到 rejection 变成未处理异常；核心只是不再接纳迟到结果，不声称能强停不合作函数。
- Markdown 和纯文本不需要 HTML 转换，但仍是不可信外部数据，协议注释已明确这一点。

## 下一步

进入 Step 7.3，实现 URL 预检、IPv4/IPv6/NAT64 公共地址判定、完整 DNS 集校验和实际连接地址固定。
