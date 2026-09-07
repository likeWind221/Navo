# 阶段 F1 前端信息架构与静态工作区收口

## 阶段目标与结果

F1 从页面信息架构出发，完成视觉方向选择、最小视觉样板、静态对话工作区以及 Electron Renderer 交互与响应式验收。最终界面按用户收敛后的范围只保留 SKILLWORLD 品牌顶部栏、消息历史和 Composer；目标、路线、Node 教材、练习及真实 Agent 对话仍由后续阶段实现。

长期规范分别保存在：

- `12-frontend-information-architecture.md`：页面层级、职责、状态与权限边界。
- `14-visual-design.md`：主题、色板、排版、组件、响应式与可访问性规范。

## F1.1 页面信息架构

### 做了什么

- 定义目标首页、目标工作区、Node 学习工作区和设置页的层级与职责。
- 明确 Node 工作区中的教材、练习与统一对话布局，以及加载、失败、取消和恢复状态。
- 明确学习者视图、Session 隔离、隐藏参考答案和未来 Preload 接口的权限边界。

### 关键决策

- Node 学习工作区是首个真实功能页面；Main Agent 与 DAG 只保留未来位置，不伪装成可用功能。
- 教材和练习属于同一 Node，统一对话使用单一 NodeSession；响应式布局不改变领域含义。
- 前端只保留草稿和请求状态，领域事实以后端确认的快照为准；内容生成或 Agent Turn 完成均不能代替 Verification。

## F1.2 视觉探索与方向收敛

### 原型与选择

- 曾实现三版独立视觉原型供比较，用户最终选定 C“山丘远征站”。
- 选中方向保留亮白画布、暖砂色、克制的探索感和宽松留白；对比原型代码随后清理，不进入生产入口。
- 地图地块后续采用 3D 建模，本阶段不使用临时 SVG 地形替代；图标采用自绘 SVG，不引入图标库、组件库或动画库。

### Miracle 只读调研

- 只读检查 Miracle 的设计 tokens、工作区布局、聊天滚动、Composer、消息渲染和加载状态，未安装其依赖或复制其实现。
- 采用可借鉴的职责：稳定消息 ID、靠近底部时滚动跟随、输入法组合态保护、纯文本安全渲染、明确加载与失败状态。
- 不采用 Tauri API、终端和文件工作台、Provider 授权 UI、通用 Gateway、复杂扩展界面及超出当前范围的依赖。

## F1.2.1 最小视觉样板

### 做了什么

- 建立 CSS tokens、自绘操作图标和 CSS Modules 视觉样板，覆盖字体、色板、按钮、标签、卡片、输入框与静态消息。
- 开发模式通过 `?preview=design` 保留样板入口，生产默认入口不加载样板模块。
- 增加前端 TypeScript solution 配置，使编辑器与 `pnpm typecheck` 使用相同的 Web/Main/Preload 配置边界。

### 关键决策

- 使用原生 button、label 和 textarea 保留键盘与语义能力。
- 样板只验证视觉基础，不伪造 Agent 行为，也不提前实现后端协议。

## F1.2.2 最小对话工作区

### 做了什么

- 实现 `WorkspaceShell`、`ChatWorkspace` 与 `Composer`，默认入口改为本地对话工作区。
- WorkspaceShell 只显示文字品牌标志；navigation 保留可选插槽，没有内容时不产生空白导航栏。
- Composer 支持空白拦截、Enter 发送、Shift + Enter 换行、输入法组合态保护和 8,000 字符上限。
- 消息只保存在 React 内存中，不请求 Agent、不伪造回复，刷新后不会作为 Session 事实恢复。

### 视觉与工程调整

- 按用户反馈将 textarea 从三行缩为两行，减小 Composer padding 与底部留白，并移除 Composer 的 focus-within 外环。
- 清理已安装依赖中的弃用用法：React `FormEvent` 改为 `SubmitEvent`，键盘判断使用 `key/isComposing`，electron-vite 改用 `build.externalizeDeps`。
- Electron、React Renderer 与开发预览分别保持独立配置；避免在 Electron 开发进程运行时并发执行生产构建覆盖 `out`。

### Qwen 流式可行性核实

- 只读确认 `local-vllm/qwen3.8-27b` 使用 OpenAI Chat Completions SSE；关闭 thinking 后正文可以产生真实增量并正常结束。
- 确认当前后端已有 `LLMAdapter`、`StreamChunk` 与 `AgentRuntime`，但没有真实 Qwen Adapter、Kernel Host、对外实时 Turn 出口或 Preload 对话桥。
- 正式接入应由后端提供模型 Adapter 与公共流式出口，再由 Electron Main 和 Preload 桥接；不让 Renderer 或 Main 直接调用模型。

## F1.2.3 交互与响应式验收

### 做了什么

- 新增可重复运行的 Electron Renderer 验收脚本，覆盖空白输入、Enter、原生 Shift + Enter、输入法组合态、消息气泡间距、焦点、长列表、长消息和 547px 窄屏。
- 删除消息段落额外的 6px 上边距，使气泡上下 padding 均为 12px、段落上下 margin 均为 0。
- 增加滚动偏好：距底部不超过 80px 时跟随新消息；用户滚离底部后保持当前位置。
- 按既有视觉决定不恢复 Composer 外环，只在聚焦 textarea 内显示细下划线。

### 验收结果

- 原生 Shift + Enter 后草稿包含换行且消息数不变；组合态 Enter 不发送，普通 Enter 正常发送并清空草稿。
- 33 条消息和长文本没有横向溢出；靠近底部时准确跟随至底部，滚离后保持 `scrollTop = 0`。
- 1280px 与 547px 两种视口截图通过视觉核对；TypeScript 检查与 Electron 验收断言全部通过。
- 验收脚本和结果保存在 `frontend/scripts/f1-2-3-qa.cjs` 与 `frontend/qa-output/`。

## 坑与发现

- Electron 隐藏窗口不会进入真实 `:focus` 状态；焦点验收使用隔离测试窗口短暂获得焦点，完成后自动关闭。
- 开发与生产构建共用 `out` 时可能干扰正在运行的 Electron 页面，后续验收应避免二者并发。
- F1 最终实现范围比早期 Node 双栏原型更小；信息架构和视觉规范仍保留未来 Node 工作区设计，但当前产品入口只呈现最小对话。

## 下一步

阶段 F1 已完成。下一步由后端完成 F2.2 Kernel Host、真实 Qwen Adapter、`agent.turn` Handler 与可脚本化 Mock Host；共享契约通过取消和断流测试后，前端进入 F2.3 Electron Main Host 生命周期与传输。
