# Step 7.1 Fetch 公共协议与错误开发记录

## 做了什么

- 新增 `src/tools/builtins/fetch/types.ts`，定义 URL 请求、最终响应 URL、HTTP 状态、截断标记及 HTML/文本正文联合类型。
- 文本正文显式区分 Markdown 与纯文本；HTML 保持原始来源形态，留给后续工具展示层转换。
- 新增 `src/tools/builtins/fetch/errors.ts`，定义 FetchError、封闭错误码和固定模型可见消息。

## 关键决策

- Fetch 协议不定义 Adapter、Provider 或 Cordis Service；后续由 Tools 根内部的普通 FetchCore 直接实现读取能力。
- 超时、字节上限、字符上限和重定向策略属于执行配置，不进入模型可选的 FetchRequest。
- FetchError 的内部 message/cause 可保留诊断，模型只能读取由错误码映射的固定 modelMessage。

## 坑与发现

- Markdown 与纯文本虽然都能直接返回模型，但显式 format 能避免后续格式层重复转换或误判 HTML。
- 非 2xx 状态暂不定义为协议错误；FetchResult 保留 statusCode，具体 HTTP 实现在 7.4 确定响应接纳规则。
- 设计复审后删除了只有单实现却携带身份字段的 FetchAdapter；测试替换点收缩为 FetchCore 或其底层请求函数，不形成公开架构层。

## 下一步

进入 Step 7.2，实现不依赖 Cordis 的 FetchCore、请求/结果校验、复制冻结、超时、取消和单次调用边界。
