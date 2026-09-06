# Step 7.9 Harness 风格完整正文语义开发记录

## 做了什么

- `web_fetch` 不再返回任何截断前缀；响应字节、解码文本、Core 正文、HTML 转换结果或模型输出超过预算时，统一返回 `response-too-large`。
- 删除 Fetch 结果中的 `truncated` 状态；只有完整 HTML、Markdown 或纯文本才能到达 Agent，上游网页无法完整保留时不制造残缺结果。
- 补充传输流、解码文本、Core 校验和工具输出的超限测试，并保留 Search→Fetch→Node 内容的集成验证。

## 关键决策

- 对齐 DeepSeek Harness 的“一次 Fetch 获取正文”职责边界，但不在本 Step 复制其通用工具结果 spill；Harness 的 spill 只能读取 Fetch 已取得的结果，也不能恢复 Provider 已截断的网页内容。
- `spill + read` 延后为独立阶段：它需要临时结果存储、生命周期清理、访问授权和受控 offset/limit 协议，不能作为 Fetch 超限时的隐式副作用。

## 坑与发现

- HTTP 的 `Content-Length` 可能缺失，因此流式读取必须在恰好达到预算后继续读到 EOF；一旦收到额外字节立即取消并报超限，不能返回已收集前缀。
- HTML 转 Markdown 后可能比源文本更长，因此最终模型输出预算也必须作为完整文档门槛检查。

## 下一步

后端进入阶段 8 无状态练习批改 MVP；出现真实长工具结果阅读需求后，再单独设计 Harness 风格的 spill 与 `read`。
