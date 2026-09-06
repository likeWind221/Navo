# Step 7.6 HTML 转换与 FetchTool 开发记录

## 做了什么

- 使用 Turndown 与 GFM 插件把有界 HTML 转为 Markdown，并删除脚本、样式、嵌入对象和隐藏节点。
- 注册 `web_fetch`，输出最终 URL、HTTP 状态、不可信内容声明和截断提示。

## 关键决策

- HTML 转换前限制输入和最大 512 层嵌套，转换失败返回固定省略标记，不把原始活动标记交给模型。
- 最终模型输出默认最多 60,000 字符；工具卸载通过同一 Cordis effect 取消在途 FetchCore。

## 坑与发现

- 网络流需要分块读取，但 HTML→Markdown 必须在有界前缀上整体解析，因为标签、列表和表格状态会跨字节块。

## 下一步

将 FetchTool 接入 Tools 根与 Node 白名单。
