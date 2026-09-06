# Step 7.7 Tools 与 Node 接入开发记录

## 做了什么

- ToolsPlugin 默认组合安全 HTTP FetchCore 和 FetchTool，同时允许测试传入自有 MockFetchCore。
- NodeAgent 白名单增加 `web_fetch`，Profile 要求先 Search 发现来源，再 Fetch 读取最有用页面后提交内容。

## 关键决策

- 不新增 `ctx.webFetch`；只有公共 `ctx.tools` 对 Cordis 暴露，FetchCore 始终是 Tools 根内部对象。

## 坑与发现

- NodeSession 单测直接组装细粒度插件，因此白名单增加工具后必须同步安装 Mock FetchTool，否则严格 Schema 选择会拒绝未知工具。

## 下一步

验证 Core、网络、HTTP 与工具安全边界。
