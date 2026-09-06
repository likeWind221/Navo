# Step 6.9.6 Exa HTTP Adapter

## 做了什么

- 新增 `src/tools/builtins/search/adapters/exa.ts` 与 `exa-response.ts`：HTTP Adapter、5 MiB 有界读取、厂商响应校验及标准结果映射。
- 可信配置仅含 apiKey，固定 POST https://api.exa.ai/search、type=auto；构造时快照密钥并以原生私有字段保存；允许注入 fetch 进行离线验证，不开放任意 Base URL。
- 不修改前端、依赖、应用组合或模型工具；本次串行登记 30 号文档与索引。

## 关键决策

- 只读对齐 Harness `packages/web/web-search-exa/src/provider.ts` 的 POST 搜索、signal 传递、拒绝重定向、首个非空 highlight 映射与无摘要条目丢弃；本项目标题回退 URL，丢弃来源时标记 truncated，并复用公共结果校验/裁剪/冻结。
- 核实当前官方文档后使用 x-api-key；Bearer 也受支持。旧 highlightsPerUrl 已弃用，改用 contents.highlights.maxCharacters=2000，不照抄 Harness 的旧参数或 keyword/neural 类型枚举。
- 结果必须有 results 数组，空数组合法；字段类型非法时报错。publishedDate 的完整可解析日期时间映射到 publishedAt；日期-only、空值或缺失不映射，避免违反当前协议或虚构午夜时刻。未来若需保留日期精度应单独扩展来源协议。
- JSON Content-Type 与 Content-Length 预检查，加上实际读取字节累加，限制为 5 MiB；字节限制针对 fetch 解码后的流，正文提取/抓取仍属于后续 Fetch 阶段。
- HTTP 非成功不读取正文，只保留状态；JSON 解析错误和原始网络错误不保存 cause，防止正文、代理异常回显凭证。非 JSON Content-Type 和坏 JSON 为 invalid-response；其他未分类传输/解码异常为 request-failed。
- signal 原样传给 fetch，读取前后检查取消；finally 取消未读完的 body 并释放 reader。期限由 SearchService 管理，直接调用 Adapter 且不传 signal 不额外设默认超时；没有重试、跨 Provider 降级或 MCP。
- mock fetch 必须遵守 fetch 的合作取消契约；框架仍不能强制停止不合作网络实现或远端处理。

## 坑与发现

- 当前官方文档与 Harness 存在 highlights 参数和日期精度差异；不要从旧参考实现推断现行厂商协议。
- 临时离线 HTTP 冒烟通过：端点/方法/认证/请求体、预取消、空结果、标题回退、摘要选择、日期映射、畸形响应、危险来源协议、HTTP 302/401/429/500、Content-Type/JSON、声明及实际超额字节、错误脱敏、body 取消与服务超时。
- `pnpm typecheck` 通过，`pnpm test` 15 文件/110 测试通过；临时脚本已删除，持久测试在 6.10.2；没有真实 Exa 请求或真实密钥验证。

## 下一步

- 人工审查后进入 6.9.7，注册 web_search 并实现模型输出边界；6.14 再做应用组合和密钥配置注入。

## 官方参考

- https://exa.ai/docs/reference/search
- https://exa.ai/docs/reference/search-api-guide-for-coding-agents
