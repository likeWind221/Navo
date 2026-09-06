# 阶段 6 Node 学习内容闭环收口记录

## 做了什么

- 新增 `tests/node-learning-integration.spec.ts`，只通过 `createApp()`、`ctx.nodes` 和 `ctx.nodeSessions` 等公开入口执行完整学习流程。
- 一个 Node 依次完成搜索、教材生成、练习题生成，并在同一 Session 中再次搜索和替换两个内容面板。
- 第二个 Node 使用同一组工具独立生成内容，验证其 Profile、SessionLog 与内容写入不能读取或改变第一个 Node。
- 验证 NodeEvent 严格重放得到当前内容快照，SessionLog 投影保留两轮用户消息、工具闭环和最终回答，学习者题集不包含参考答案。

## 关键决策

- 端到端测试使用 Mock LLM 和 Mock Search，固定覆盖 12 次模型请求、3 次搜索和 3 个完整 Turn，不依赖网络、密钥或 Provider 波动。
- 真实搜索继续使用已经完成独立协议测试和真实冒烟验证的 Exa Adapter；密钥只允许由后续可信 Kernel Host 注入，Node 与模型参数都不能提供凭据。
- 当前教材和题集规模适合直接记录在内存 NodeEvent 中；持久化落地后根据真实内容体积评估正文外置、内容寻址和历史压缩，本阶段不提前引入对象存储。

## 坑与发现

- SearchService 会在调用 Adapter 前把省略的 `maxResults` 规范化为 8，端到端断言必须以公共服务输出契约为准。
- 工具虽然全局注册，但 12 次 NodeAgent 模型请求看到的 Schema 始终严格等于 Node 白名单；第二个 Node 调用内容工具时只能更新其自身 Session 绑定的 Node。

## 下一步

阶段 6 已收口。下一阶段规划独立 `web_fetch`，把调研路径扩展为“搜索 → 选择来源 → 读取正文 → 生成或修改内容”；F2.2 Kernel Host 与真实 Qwen 对话链路按跨端计划独立推进。
