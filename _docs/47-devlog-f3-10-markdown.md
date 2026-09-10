# F3.10 Markdown 消息展示

## 做了什么

- 按用户授权连续完成 F3.10.1 格式化消息和 F3.10.2 流式阅读；F3.10.3 自动检查通过，人工验收待确认。
- `chat/Markdown.tsx` 将累计文本解析为 GFM mdast；`chat/markdown/render.tsx` 直接生成 React 元素，支持标题、强调、引用、列表、任务列表、表格、代码、引用链接和脚注。
- `chat/List.tsx` 接入旧版正文、新版正文和折叠思考；用户输入、工具内容、命令提示保留纯文本。
- `chat/markdown/style.module.css` 管理 Markdown 排版与代码/表格内部滚动；原消息布局只收窄纯文本段落样式作用域，保留用户当前的桌面 48px、窄屏 28px 消息 padding。
- `shared/link.ts` 为 Renderer/Main 共用链接校验边界，限定绝对 HTTP(S)/mailto URL；Main 拦截页面导航，外链走已有系统打开入口。
- `scripts/qa/markdown.ts` 和专用 preload 在真实 Electron 中注入确定性事件，使用正常 Chat 状态与组件；测试入口不进入正常应用组合。

## 关键决策

- 子 Agent 只读对照 `deepseek-harness/packages/client/ui-primitives/src/markdown/parse.ts`、`render.tsx`、`MarkdownText.tsx`、`incremental.ts` 与 `CodeBlock.tsx`，采用 mdast → React、GFM 和安全链接机制；依赖版本沿用本地 DSH 锁定版本。
- 每个内容块按累计字符串完整解析，React memo/useMemo 复用未变化内容。没有移植 DSH 冻结最后两个块的缓存，避免引用链接/脚注跨冻结边界导致中间态不一致；未进行超长回答性能基准。
- DSH 正文接 Markdown、思考单独展示；本项目让正文与思考共用 Markdown 是本地需求扩展。
- 首版标准 GFM，不移植 DSH 特殊 CJK 强调扩展、数学双 grammar、KaTeX、Shiki、文件按钮或远程图片。图片只显示 alt，raw HTML 只作转义文本，不使用 HTML 注入。
- `Markdown.tsx` 是 React 缓存与实例 ID 所有者；短文件 `shared/link.ts` 是两进程共用的 URL 安全边界；QA preload 是独立执行环境入口，均保留独立文件。
- 本轮无新增后端/RPC 契约，无后端改动；主 Agent 串行维护本记录、前端计划与索引。

## 坑与发现

- 原 `.message p` 的 pre-wrap 与零段落间距会干扰 Markdown 排版，已限定到用户/命令纯文本；工具段落单独保留原换行规则。
- Electron 原 `setWindowOpenHandler` 对 URL 无协议限制，现与 Renderer 使用同一校验函数；外部应用实际打开行为留给人工验收，不在自动测试中拉起系统浏览器。
- 自动检查：`pnpm --dir frontend typecheck`、`build`、定向 Markdown/List 测试（13 项）和 `qa:markdown` 均通过。
- Electron 验证跨 delta 粗体与未闭合围栏、默认折叠思考、停止保留内容、底部自动跟随、回看不拉扯、输入区 padding 遮挡。547px 窗口下 history 可视/滚动宽均 518px，代码与表格仅内部溢出；Renderer 无错误。已查看宽屏/窄屏截图。
- 产物：`frontend/qa-output/markdown-desktop.png`、`markdown-narrow.png`、`markdown-results.json`。

## 下一步

- 已执行 `pnpm --dir frontend dev` 启动正常 Electron，日志确认 `[kernel-host] ready`；用户用真实模型人工验收，确认后将 F3.10.3 标为完成。
- 人工建议输入：请用 Markdown 展示标题、粗体、引用、有序列表、任务列表、8 列表格、带长行的 TypeScript 代码块和 HTTPS 链接，不要把整个回答包进代码块。
