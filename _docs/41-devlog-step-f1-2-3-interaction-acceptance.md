# F1.2.3 交互与响应式验收

## 做了什么

- 新增可重复运行的 Electron Renderer 验收脚本，覆盖空白输入、Enter、原生 Shift + Enter 换行、输入法组合态、消息气泡间距、长列表、长消息、窄屏和焦点状态。
- 修正消息段落额外上边距；新增靠近底部时自动跟随、滚离底部后保持位置的滚动行为。
- 按既有视觉决定不恢复 Composer 外环，只在聚焦的 textarea 内显示细下划线。

## 关键决策

- 滚动跟随使用距底部 80px 阈值；用户主动查看旧消息时，新消息不会抢走位置。
- 验收脚本直接运行 Electron `BrowserWindow`，输出断言数据和 1280px、547px 两种截图，不依赖后端或真实 Agent。

## 坑与发现

- 隐藏窗口不会进入真实 `:focus` 状态，最终验收让隔离测试窗口短暂获得焦点后验证，结束时自动关闭。
- 原生 Shift + Enter 后草稿为 `第一行\n` 且消息数不变；33 条消息和长文本没有横向溢出；长列表靠近底部时落在底部，滚离后保持 `scrollTop = 0`；气泡上下 padding 均为 12px，段落上下 margin 均为 0。
- TypeScript 检查和全部 Electron 验收断言通过；未在开发进程运行时并发覆盖生产构建产物。

## 下一步

等待后端完成 F2.2 Kernel Host、真实 Qwen Adapter 与 `agent.turn` Handler，再进入 F2.3 Main Host 生命周期与传输。
