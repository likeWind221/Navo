# F3.11 数学公式展示

## 做了什么

- 正文与折叠思考中的公式现在按 KaTeX 排版：`$...$`、`\(...\)` 为行内公式，`$$...$$`、`\[...\]` 为块级公式。
- `markdown/parse.ts` 用两套语法解析同一段累计文本：生成中只启用 GFM，内容结束后才加入数学扩展，因此生成过程中不会出现半截公式排版错误。
- `markdown/Math.tsx` 是唯一接触 KaTeX 的组件，把公式值渲染为带 `data-math` 标记的容器；`markdown/render.tsx` 只把 mdast 的 `math` / `inlineMath` 分派给它。
- 无效公式保留可读原文（KaTeX 错误样式），`\href` 等命令不产生链接；宽公式在消息列内横向滚动。
- `scripts/qa/markdown.ts` 在真实 Electron 中注入公式样本，并新增结构化产物字段（公式总数、行内与块级 KaTeX 数、错误数、不可执行元素数、窄窗滚动宽度）。
- `chat/tests/Math.spec.tsx` 扩充到 25 项：分隔符配对与相邻、转义、嵌套、生成中与结束后的语法切换、旧版正文与用户输入的区别。

## 关键决策

- 只读对照 DSH 客户端 Markdown 实现：`fromMarkdown` + GFM/math 扩展直接产出 mdast，再手写 mdast → React 分派；不引入 unified/remark/rehype，也不使用 HTML 注入。
- 采用 DSH 的“生成中用轻语法、结束后用完整语法”机制：本项目在生成中完全关闭数学扩展，结束后同时启用 `micromark-extension-math` 与自带的 `$$...$$` / `\[...\]` 流式构造，保证只有闭合分隔符才进入 KaTeX。
- 与 DSH 的两点有意差异：DSH 只支持 `\(...\)` 行内公式，本项目额外支持 `$...$`；DSH 把 KaTeX HTML 字符串经 DOMParser 转成 React 元素，本项目直接 `katex.render` 到容器节点，配合 `trust: false`、`throwOnError: false` 达到同样的“无 HTML 注入、无危险命令执行”结果。
- 未移植 DSH 的冻结尾部缓存与 ```` ```math ```` 围栏延迟渲染；本项目每次增量都整段重新解析，代价由 `memo` 与公式值不变时跳过 KaTeX 重排控制。
- 本轮无新增后端/RPC 契约，无后端改动；主 Agent 串行维护本记录、前端计划与索引。

## 坑与发现

- 无效公式 `$\frac{$` 也会生成 `[data-math]` 容器（内容为 `.katex-error`），因此公式容器总数包含错误项：样本中 8 个容器 = 7 个成功排版 + 1 个错误；早期按“仅成功项”计数会误判。
- `\href{javascript:...}` 在 `trust: false` 下不进入 KaTeX 的 `.katex-error` 分支，而是把命令名渲染成红色普通文本，所以它既不产生链接也不计入错误数；QA 用“公式容器内无 `<a>`/`<img>`/`<script>`”断言这一边界。
- 未闭合的 `$$` 会作为普通段落文本保留（`literalFence` 断言），不会吞掉后续内容。
- 自动检查：`pnpm --dir frontend typecheck`、`build`、86 项测试（其中 Math 25 项）和 `pnpm --dir frontend qa:markdown` 全部通过；QA 记录 `settled.{formulas:8,inline:3,display:4,errors:1}`、`wideMath.{untrusted:0,scrolled:1,scrolledWidth:2013,scrolledClient:462}`、控制台错误为空。
- 产物：`frontend/qa-output/math-desktop.png`、`math-narrow.png`、`markdown-desktop.png`、`markdown-narrow.png`、`markdown-results.json`；已查看宽屏与 547px 窄屏截图，公式排版、矩阵、积分、横向滚动条与错误原文显示均正常。

## 下一步

- F3.11 已收口：真实模型桌面人工验收通过，F3.10.3 与 F3.11.3 已标为完成。
- F3 阶段无待办步骤；后续若要语法高亮、Mermaid、公式缓存或冻结尾部优化，再单独规划。
