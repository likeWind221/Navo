# F2.6 流式对话界面

## 做了什么

- `ChatWorkspace` 已接入 `useAgentConversation`，真实消息、活动状态、发送和取消替代 F1 本地消息数组。
- 新增 `MessageList`，展示用户气泡、助手正文、等待、流式光标、取消、失败和截断状态。
- `Composer` 在生成期间切换为停止按钮，同时保留草稿编辑、Enter 发送、Shift+Enter 换行和输入法组合态保护。
- 新增完整 Electron QA 入口，覆盖 Main、Preload、Renderer、RPC、Mock Host 和真实 Qwen Host。

## 关键决策

- 正文直接显示真实 delta，不增加人为逐字定时器；React 只合并同一绘制帧内的更新，不延迟完成语义。
- 用户位于底部 80px 范围内才自动跟随；主动滚离后，长回复不会强制改变阅读位置。
- 助手正文继续使用 React 文本节点和 `white-space: pre-wrap`，不解析 Markdown 或 HTML。
- 流式光标和等待点遵循 `prefers-reduced-motion`，终态立即移除动效。

## 坑与发现

- Vitest 原配置只发现 `.spec.ts`，必须显式加入 `.spec.tsx` 才会执行组件渲染测试。
- 隐藏 Electron 窗口会节流绘制并产生过期截图，QA 改为可见窗口后再捕获桌面与窄屏画面。
- QA 入口从 `out/main` 直接启动时需要显式设置仓库根目录，避免 Host 的 `tsx` 路径多偏一层。
- 参考 `deepseek-harness/packages/core/agent-loop/src/{index,agent}.ts` 的流式前缀保留、取消收敛和终态优先；UI 没有引入人工打字队列、Markdown、工具调用展示或多会话。

## 验证结果

- 9 个测试文件、32 项测试通过，TypeScript 与 Electron build 通过。
- Mock 全链路在 140ms 时显示 200/2220 字符、停止保留 160 字符，完成正文完整；桌面和 560px 窄屏无横向溢出。
- 滚到顶部后，后续 2220 字符回复保持 `scrollTop=0`；真实 Qwen 全链路成功返回 8 字正文并正常完成。

## 下一步

进入 F2.7，补齐错误矩阵、中文 IME 和桌面生命周期的集中验收，再决定真实对话是否作为默认桌面入口。
