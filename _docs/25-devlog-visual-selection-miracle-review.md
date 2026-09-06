# 视觉定稿方向与 Miracle 前端调研

## 做了什么

- 用户选定 C 山丘远征站，提炼为 `24-visual-design.md`，保留亮白、暖砂、六边形山地、横向任务卡和双栏工作区。
- 按用户要求删除 A/B/C 对比原型、地形示例和原型样式，保留可启动的 Electron/React 与浏览器预览骨架。
- 只读克隆 https://github.com/likeWind221/Miracle 到项目外临时目录，未安装其依赖、未运行其脚本、未复制实现。
- 调研版本：`61f3ae987b6217518417b43a56cdb37f8886afb7`。以下为源码审阅，不是运行时体验验收。
- WebFetch 已核对仓库 README：当前正由旧 sidecar 迁移到 WebView 直连 Kernel Host；具体投影实现仅代表上述提交，不作为稳定跨端契约。

## 关键决策

### 最值得借鉴的部分

| Miracle 源码位置 | 观察到的机制 | SkillWorld 的采用建议 |
|---|---|---|
| `src/styles/tokens.css` | 语义颜色、间距、圆角集中定义，映射到主题 | 优先采用方法，但使用方案 C 的暖白色系；代码字体独立等宽，不照抄其宋体 mono 设置 |
| `src/components/layout/WorkspacePanel.tsx`、`AppShell.tsx` | 侧面板开合、拖拽宽度，按 Session 保存工作区状态 | 后续支持教材/对话尺寸与 Node 级视图恢复；拆成独立布局机制，不复制巨型组件 |
| `src/components/chat/ChatView.tsx`、`use-chat-scroll.ts` | Virtuoso 虚拟列表、稳定条目 ID、仅在底部跟随输出、返回底部、会话切换处理 | 先借鉴不抢滚动位置的交互；长历史确有性能需要后再引入虚拟列表，不直接照搬延时滚动修正 |
| `src/components/layout/ComposerPreview.tsx` | Enter/Shift+Enter、isComposing 检查、运行中输入相关状态 | 接入真实对话时优先落实中文输入法与取消边界；不提前引入 steering 或完整 Coding Agent 输入功能 |
| `src/components/chat/MessageText.tsx` | react-markdown、rehype-sanitize、GFM、代码高亮与复制 | 后续对话富文本可参考安全渲染边界；教材当前纯文字，不提前更改内容协议；外链必须走 Electron 的受限打开接口 |
| `src/lib/chat/session-projection-store.ts` | Session 分区、序号去重、缺口识别、浏览器只持有读模型 | F2 协议确定后借鉴恢复策略；只消费公共 DTO，不搬其对 sidecar 私有投影的直接 import |
| `src/components/layout/SidecarLoadingScreen.tsx` | 品牌加载态、就绪后过渡、失败重试、计时器清理 | 借鉴启动状态与释放边界，不采用模拟 86% 作为真实进度；无可测阶段时使用不定进度 |
| `design-qa.md` | 明确视口、状态、截图对比、控制台与构建记录 | 纳入正式视觉验收，避免再次把 HTTP 200 或构建成功误认为页面可运行 |

### 不直接照搬

- Miracle 是 Tauri 2 + React 19，SkillWorld 是 Electron + React；不迁移桌面壳，不直接引入 Tauri 窗口 API。
- Miracle 的代码工作台有终端、文件浏览、Provider 鉴权与扩展 UI，学习 Node 不需要把这些能力全部搬进来。
- `AppShell.tsx` 1054 行、`WorkspacePanel.tsx` 803 行、`ComposerPreview.tsx` 644 行；职责和交互可参考，但不满足本项目 300 行约束。
- 部分展示层与桌面 API/sidecar 私有实现直接耦合；本项目需保持 Renderer → 公共前端接口 → preload 的受限边界。
- ChatView 自动 8 秒隐藏错误不作为默认策略；重要失败应保留到用户处理或显式关闭。

## 坑与发现

- 原型 C 的浅灰标签和小字号只适合初期方向比较；规范提高了正文、辅助文字和焦点的可访问性要求。
- 前端需要分别验收 Electron 构建与浏览器运行；构建工具配置不同曾导致 React 全局变量缺失白屏。
- 方案已选不等于 F1.2 完成：旧代码已清理，正式工作区、完整空态/错误态和人工视觉验收仍待实现。
- 清理后前端 typecheck、浏览器生产构建与 Electron 三部分构建通过；源码已无 prototype/Terrain 引用。没有运行 Miracle 或后端测试。

## 下一步

按选定设计重新实现 F1.2 静态工作区，优先 tokens 与小组件组合；先不添加 Miracle 的额外依赖和后端协议。F1.2 保持进行中。

### 视觉 v1 基线补充

用户明确暂不使用图标库，图标与地形全部自绘 SVG；组件视觉自定义，使用 CSS tokens + CSS Modules 和 CSS 动效，不引入组件库或动画库。`24-visual-design.md` 已确定为 v1.0，并补充图标网格、描边、无障碍和技术边界。前端计划将剩余 F1.2 拆成视觉样板、静态组合、状态/响应式验收三个待确认子步骤；本次仅修订文档，未创建实现文件或执行代码测试。
