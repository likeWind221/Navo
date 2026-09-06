# Step 7.0 Search Tool 边界收缩开发记录

## 做了什么

- 删除 `src/tools/builtins/search/service.ts` 及 `ctx.search` Cordis Service。
- SearchTool 改为在构造时接收单个 SearchAdapter 和可选超时，直接调用普通 `executeSearch` 函数。
- `executeSearch` 接管请求规范化、Adapter 校验、结果复制冻结、超时、取消和未知错误归一化。
- ToolsPlugin、Node 测试、Search 工具测试和真实 Exa 冒烟脚本改为通过 SearchTool 配置注入 Adapter。
- 原 `tests/search-service.spec.ts` 替换为 `tests/search-execution.spec.ts`，删除无实际消费者支撑的动态注册与 Provider 路由测试。

## 关键决策

- Cordis 只暴露跨插件共享的 `ctx.tools`；具体工具不再各自暴露 Service。
- Search 的 Provider 选择由可信 Host 在构造 Adapter 时完成，不在应用 Context 内维护动态注册表。
- 未配置 Adapter 时仍注册 `web_search`，保证 Node 白名单中的工具 Schema 稳定，执行时返回固定的 Provider 不可用错误。

## 坑与发现

- Cordis 会自动清理 `ctx.effect`，但普通插件返回函数不适合承载额外的在途取消；生命周期 AbortController 和工具注销必须放进同一个 effect 清理函数。
- 移除四类动态注册/路由场景并新增工具卸载取消场景后，完整测试由 151 项调整为 150 项，所有当前行为均通过。

## 下一步

进入 Step 7.1，定义与 Node、Cordis 和 HTTP 实现无关的 Fetch 公共协议与安全错误。
