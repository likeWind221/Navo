# Step 7.4 HTTP Fetch 实现开发记录

## 做了什么

- 新增 `http.ts`，构造 FetchCore 使用的匿名 HTTP 读取函数，逐跳重新解析并固定同源重定向目标。
- 新增 `response.ts`，分类 HTML、Markdown 与纯文本，按声明和实际字节流限制正文，并按 charset 解码和字符预算截断。

## 关键决策

- 请求只发送固定 User-Agent 与 Accept，不读取 Cookie、Authorization 或模型请求头；跨源重定向要求新的工具调用。
- 默认响应上限 5 MiB、解码正文 100,000 字符、同源重定向 5 跳；所有路径取消 Body 并关闭私有 Dispatcher。

## 坑与发现

- 恰好填满字节预算不代表截断，必须继续读取一次确认 EOF；只有实际丢弃字节才设置 truncated。

## 下一步

实现确定性 Mock FetchCore。
