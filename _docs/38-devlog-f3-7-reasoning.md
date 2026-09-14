# F3.7 思考内容修正

## 做了什么

- Host 默认启用 thinking，保留 `LLM_ENABLE_THINKING=false` 显式关闭能力。
- Qwen SSE Adapter 读取真实服务的 `delta.reasoning`，转换为既有 `contentType: "reasoning"` ModelEvent；调整原测试输入并验证 Host 默认值及关闭覆盖。
- 相关 3 个测试文件共 24 项通过，后端 typecheck 通过。真实模型经生产 Adapter 返回 reasoning 144 字符、正文 3 字符，终态 stop；仅输出计数，不保存思考原文。

## 关键决策

- 只在 Adapter 处理服务字段差异，不增加 `reasoning_content` 响应兼容分支。内核、RPC、Renderer 不改。
- 只修改 Host 的默认开关；Adapter 独立构造默认值仍为 false，由 Host 显式传入 true。请求中的历史 assistant `reasoning_content` 序列化不属于此次响应字段修复。
- 只读参考 `deepseek-harness/packages/llm/llm-deepseek/src/translate.ts`：Provider 转换层将外部字段转成统一 reasoning 内容事件；本项目采用这一边界，但使用实测 Qwen 的 reasoning 字段，不照搬 DeepSeek 的 reasoning_content 字段。

## 坑与发现

- 原测试使用 reasoning_content，未覆盖实际服务的 reasoning，导致测试通过而真实思考文本被忽略。
- 默认输出预算仍为 8192，思考占用同一输出预算。当前验证未包含重启后的 Electron 人工交互或多轮工具回传。

## 下一步

- 重启桌面与 Host，复验折叠的“思考中／思考过程”区域。无新增公共契约待落实；此次仅交付后端修复，不替代前端人工验收。
