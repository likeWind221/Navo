# F1.2.2 最小对话工作区（已验收）

## 做了什么

- 按用户新范围只组合 SKILLWORLD 文字标志顶部栏和干净对话区，不做节点标题、教材、练习或地图。
- WorkspaceShell 预留 navigation 插槽，无内容时不产生导航 DOM 或空白宽度。
- Composer 支持本地添加消息、空白拦截、Enter/Shift+Enter 与输入法组合保护；不请求 Agent、不伪造回复。
- 原样板留在开发模式 `?preview=design`，默认入口改为对话工作区。

## 关键决策

- UI 消息只是页面内存，不是 Session 事实；明确提示离线、本地与刷新丢失。
- 草稿由 Composer 持有，消息由 ChatWorkspace 持有，外壳只管布局；共享 CSS tokens，工作区 CSS Modules 隔离。
- 顶部栏仅文字标志，历史独立滚动、底部输入固定于布局，不引入新依赖。

## 坑与发现

- typecheck、Electron build 与浏览器生产 build 通过；本次手写文件均低于 300 行。
- 尚未实际验证浏览器键盘/输入法和各视口截图；没有流式输出、停止、持久化、虚拟列表或自动滚动跟随。
- 纯前端本地交互，不涉及 Harness 协议或取消语义；不触碰后端文件。

### Electron 桌面启动验证

- 用户要求以后优先通过 Electron 窗口验收，前端计划已记录 `pnpm --dir frontend dev` 为主要入口。
- 原 Node 下载器仍超时；改用 curl 从 Electron 官方 GitHub Release 下载同版本 44.2.0 Windows x64 压缩包，验证与已安装 npm 包自带 checksums.json 的 SHA256 一致后，使用包自身解压器安装到 node_modules。
- 未禁用证书/校验或 sandbox，未更改依赖版本。启动 electron-vite dev 成功，操作系统查询确认本项目前端 Electron 进程存在标题为 SkillWorld 的桌面窗口。
- 仅验证窗口启动；页面内容、中文输入法与交互仍需人工查验。后台开发进程为当前验收保留，关闭窗口后结束。

### 输入区微调与弃用 API 清理

- 按用户反馈删除工作区 Composer 的 focus-within 外环，将边框由 control-border 改为更浅的 border，文本区从三行改为两行，减少 padding 与底部间距；保留按钮键盘焦点。
- 按已安装依赖声明确认并替换三处弃用 API：React FormEvent → SubmitEvent；KeyboardEvent.keyCode → key/isComposing；electron-vite externalizeDepsPlugin → build.externalizeDeps。
- 未笼统声称所有库 API 均无弃用；本次针对手写前端源码与实际声明检查，typecheck、Electron build、浏览器 build 通过。真实输入法与焦点视觉仍需桌面验收。
- 用户术语查阅入口：Ant Design 中文组件总览 https://ant.design/components/overview-cn/ 、Element Plus 中文组件总览 https://element-plus.org/zh-CN/component/overview 、MDN outline https://developer.mozilla.org/zh-CN/docs/Web/CSS/outline 。这些站点仅作名称和状态示例参考，不代表引入对应库。

### 桌面布局排查

- 用户反馈布局错乱后重新启动 Electron，临时通过本机 CDP 读取计算样式并截图核对：1267×739 CSS 像素视口、顶部栏 76px、输入区约 752×130px，CSS Modules 类名及暖白变量生效，当前未复现错乱。
- 截图位于系统临时目录 `skillworld-desktop-check.png`。检查后关闭临时调试窗口，使用普通 `pnpm --dir frontend dev` 重新启动，操作系统确认 SkillWorld 窗口存在。
- 尚不能断定原故障根因；开发和生产构建共用 out，后续避免在桌面开发进程运行时并发执行生产构建，以排除产物覆盖干扰。

### 下一阶段模型接口只读核实

- 本机 Pi models.json 配置：provider `local-vllm`，模型 `qwen3.8-27b`，OpenAI Chat Completions，base URL `http://192.168.99.2:8090/v1`；只读取所需配置并在请求内使用鉴权，未输出密钥、未修改服务器或 Pi。
- `/models` 返回 200 且列出该模型；简短问候 SSE 请求成功。150 字正文请求使用默认参数和 max_tokens=350 时没有正文、finish_reason=length，不能把截断认定为正常空回复。
- 同一正文任务加 `chat_template_kwargs.enable_thinking=false` 后成功：44 次正文 delta、174 字，首正文约 283ms、末正文约 1503ms，finish_reason=stop 与 [DONE] 齐全。单次测量仅证明当前可用，不代表性能承诺。
- 只读核对项目 LLMAdapter/StreamChunk、Agent 输入与应用组合：已有流式抽象，src/llm 当前只有 Mock 实现，preload 当前仅暴露桌面元信息，还没有对话桥接。
- 参考 Harness llm-pi-ai/src/stream.ts 的事件翻译：正文与 reasoning 分离，取消/错误/正常终止分开，缺失终止事件判定流中断。当前目标不引入 Pi Agent、工具回放或完整 Harness 能力。
- 建议由后端补真实模型适配与公开流出口，串行定义契约，再由前端桥接并渲染。用户本次询问方案，未授权实现；相关需求记录前端计划，不越界修改后端。

## 下一步

F1.2.3 已完成交互与响应式验收；下一步等待后端 F2.2 Host 契约落地后进入 F2.3，不恢复已删减面板。
