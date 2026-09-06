# 阶段 7 Fetch 调研闭环收口记录

## 做了什么

- 新增公开入口端到端测试，完成 `web_search → web_fetch → 教材 → 练习题 → 再次搜索/读取 → 修改教材`。
- 验证 Fetch 结果进入下一次模型请求和 SessionLog，HTML 脚本被移除，NodeEvent 只记录最终领域内容。
- 新增显式 `--live` 冒烟脚本，只输出 HTTP 状态、正文类型、长度和截断状态，不打印外部正文。

## 关键决策

- 7.9 后 `web_fetch` 只有在整个正文可在传输、解码、转换和模型输出预算内保留时才返回；任一预算超限返回 `response-too-large`，不再返回截断前缀。

- 阶段 7 只支持 HTML、Markdown 和纯文本；图片、视频、PDF、浏览器渲染、登录态和 PowerShell 媒体处理均不进入当前范围。
- FetchCore、HTTP、网络与 Tool 全部归 Tools 根内部，不暴露 Adapter 注册表或 Cordis Service；Node 只通过 per-turn 白名单获得能力。

## 坑与发现

- 当前环境访问 `https://example.com` 的真实冒烟被公共网络策略以 `blocked-url` 拒绝，说明 DNS/代理提供了非公网或特殊地址；没有放宽 SSRF 规则绕过。
- 真实本地 HTTP 固定连接、全部 28 项 Fetch 专项测试、全项目 197 项测试、typecheck 和 build 均通过。

## 下一步

后端可进入阶段 8 无状态练习批改 MVP；真实公网 Fetch 需在返回真实公网 DNS 地址或提供兼容固定目标校验的可信代理环境中复验。
