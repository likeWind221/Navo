# F2 Electron 调用 Agent 规划

## 做了什么

- 将前端计划中的 F2 从方向占位拆为 F2.R–F2.7，覆盖共享契约、Backend Kernel Host、Electron Main、Preload、Renderer 状态、流式 UI 与桌面验收。
- 明确正式链路为 Renderer → Preload → Main → Kernel Host → Agent Runtime，不采用 Renderer 或 Main 长期直连 Qwen。
- 写明后端交接清单、最小产品范围、实施顺序与阻塞门槛；本次未实现代码，也未修改后端计划。

## 关键决策

- 共享契约先于实现，必须版本化、运行时校验，并定义 snapshot、相关 ID、sequence、终止、错误、取消、兼容和尺寸边界。
- 流式 delta 只负责即时展示，持久事实由 Host 的 Session snapshot/完成事实确认；取消保留部分输出但忽略迟到 delta。
- F2 首版单会话、纯文本、单在途 Turn、工具默认禁用；真实 delta 优先于人为打字延迟。

## 坑与发现

- 当前后端已有 LLM StreamChunk、Agent Runtime 与 Session Event 基础，但没有真实 Qwen Adapter、桌面对外 Host 或前端可消费的实时 Turn 出口。
- Harness 的 baseline-first、相关 ID、取消贯穿、正文/reasoning 分离和缺终止即断流值得采用；其通用 Gateway、Waterfall 和多 Carrier 超出当前范围。
- 跨端契约是共享控制面，必须指定唯一写入者并串行处理；后端 F2.2 应由后端 Agent 自行写入后端计划。

## 下一步

用户确认后进入 F2.1：先协调共享契约写入者，再与后端 Agent 对齐 Host 能力；契约确认前不创建 IPC 或模型直连代码。
