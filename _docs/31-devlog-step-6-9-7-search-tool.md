# Step 6.9.7 搜索工具、模型输出与真实 Exa 验证

## 做了什么

- 新增 `src/tools/builtins/search/{tool,format}.ts` 和 `scripts/search-smoke.ts`；注册 web_search，定义 query/maxResults 参数，通过 SearchService 执行，输出有界来源 JSON。
- 用户授权后，从 `~/.claude.json` 的 `mcpServers.exa.headers["x-api-key"]` 在内存中读取密钥，注入 Exa HTTP Adapter，不经过 MCP、不复制或打印凭证、不修改原配置。
- 脚本默认不联网，必须显式传 `--live`，固定执行一次公开主题查询，最多请求 2 条来源，无自动重试。

## 关键决策

- 对齐 Harness `packages/web/tool-web/src/search.ts` 的薄工具、服务委托、外部来源提示与引用要求；不采用多查询并发、生成式答案、UI meta 或独立 Fetch。
- 工具依赖 tools/search，通过 Cordis effect 持有注册撤销；模型授权仍由 per-turn 白名单决定，注册本身不授予权限。
- 当前 Schema 引擎不支持 min/max 等约束，因此 Schema 限定类型与拒绝未知字段，数值/长度边界仍由 SearchService 校验，不扩展通用 Schema 引擎。
- 输出预算 30000 字符，逐条试装完整来源，超预算停止添加并标记 truncated，不截断 JSON 或 URL；来源采用 JSON 编码，尖括号额外转义以防伪造外层标签。
- 不可信提示及边界标记只是防御措施，不保证消除提示注入；来源数据不能授予调用工具的权限。
- 工具把 SearchError 的固定 modelMessage 转为 ToolExecutionError，其他异常使用固定通用消息，不保留原始诊断或 cause；调用方取消仍由 ToolService 识别为 cancelled。
- 脚本只输出成功/失败和文本长度，不输出外部正文；Ctrl+C 传递取消，finally 释放 Context；正式应用组合仍在 6.14。

## 坑与发现

- 首次脚本在发送请求前因 createToolCallId 缺少字符串参数退出，补充 randomUUID 后完成一次真实搜索，工具输出 4596 字符；未重复请求。
- 根 typecheck 不包含 scripts，额外用 tsc --ignoreConfig 对该脚本检查并修复 ContentBlock 的 text 类型收窄。
- 离线冒烟发现插件仅返回撤销函数不足以确保此处注册清理，改为显式 ctx.effect 后卸载验证通过。
- 最终验证：根 typecheck、脚本独立类型检查、15 文件/110 测试通过；离线验证工具白名单、未知参数/越界参数拒绝、预取消、输出预算、边界转义及卸载；git diff --check 通过（既有换行警告除外）。
- 发现现有两个 30 号开发记录（Exa 与前端最小聊天），本次未跨界改名前端文档，顺延用 31 并记录待协调冲突；索引本次串行更新。

## 下一步

- 进入 6.10.1 服务正式行为测试；6.10.2/6.10.3 分别覆盖 Exa HTTP 与工具闭环。
- 6.14 明确生产配置注入，不把 Claude Code 配置路径固化到生产 Service 或 Adapter。
