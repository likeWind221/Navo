# SkillWorld 前端开发计划

## 1. 当前范围

前端采用独立的 Electron + React + TypeScript 工程，先建立桌面运行壳与可演进的 Renderer，再围绕后端已经稳定的公开契约逐步实现学习界面。

工程骨架与页面信息架构已经完成，当前准备实现 Node 学习工作区的静态界面；不提前固化尚未实现的 DAG、RPC、状态管理或设计系统。

## 2. 开发方式

- 主要视觉与交互验收使用 Electron 桌面窗口：根目录执行 `pnpm --dir frontend dev`；浏览器 `dev:web` 仅作辅助排障。生产构建检查可执行 `pnpm --dir frontend build` 后 `pnpm --dir frontend preview`，不以网页检查替代桌面验收。

- 前端 Agent 只修改 `_docs/frontend-plan.md`、`frontend/**` 及明确分配给前端的开发记录。
- 不直接导入根目录 `src/**` 的后端私有实现；跨边界数据必须经过后续定义的稳定 IPC/RPC 契约。
- `frontend/package.json` 与 `frontend/pnpm-lock.yaml` 独立管理依赖，避免与后端根包并发写锁文件。
- 涉及 `_docs/00-skillworld-prd.md`、`_docs/index.md`、`CLAUDE.md` 或跨端契约时，先停止并发修改并由一个 Agent 串行提交。
- 严格执行“一个 Step → 人工审查 → 确认后继续”，完成 Step 时同步开发记录、索引和本计划状态。

## 3. 状态说明

- ⬜ 未开始
- 🔄 进行中
- ✅ 已完成
- ⏸️ 延期
- ⛔ 阻塞

## 阶段 F0：Electron + React 工程骨架

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | F0.1 桌面前端骨架 | `frontend/{package.json,electron.vite.config.ts,tsconfig.*.json,index.html,electron/**,src/**}` | 建立独立 Electron main/preload、React renderer、严格 TypeScript 配置和最小占位界面 | 前端依赖独立锁定；typecheck 与 build 通过；Renderer 不启用 Node integration |

## 阶段 F1：产品信息架构与静态工作区

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | F1.1 页面信息架构 | `_docs/21-frontend-information-architecture.md` | 根据 PRD 明确目标、路线、Node 工作区和设置的页面关系 | 形成可审查的导航与页面职责，不假设未实现的后端接口 |
| ✅ | F1.2 Node 学习工作区静态界面 | `_docs/24-visual-design.md`、`frontend/src/**` | 已按用户收敛后的最小范围实现品牌顶部栏、本地对话和输入区，并完成交互与响应式验收 | 不接真实数据；输入、滚动、窄屏与基础可访问性已在 Electron Renderer 验证 |

### F1.2 剩余实施拆分

设计基线：`_docs/24-visual-design.md` v1.1。图标与组件视觉自定义；地图地块后续采用 3D 建模，本阶段不做地形资产，暂不引入图标库、组件库或动画库。

| 状态 | 子步骤 | 目标文件（计划，尚未创建） | 工作内容与完成标准 |
|---|---|---|---|
| ✅ | F1.2.1 视觉基础与样板 | `frontend/src/styles/tokens.css`、`frontend/src/ui/Icon.tsx`、`frontend/src/preview/DesignSample{.tsx,.module.css}`、`App.tsx`、`styles.css` | 最小样板已实现并收敛到当前对话界面：色板/字体、按钮/标签、卡片/输入框和消息，三个自绘操作图标；不制作地块 |
| ✅ | F1.2.2 最小对话工作区 | `frontend/src/workspace/**`、`frontend/src/App.tsx` | 按用户最新要求只实现品牌顶部栏和本地交互式对话，导航预留可选插槽但不渲染；不做教材、练习、节点标题；已完成交互验收 |
| ✅ | F1.2.3 状态与响应式验收 | `frontend/src/workspace/**`、`frontend/scripts/f1-2-3-qa.cjs`、`frontend/qa-output/**` | 已验证草稿、空白输入、输入法组合态、长消息、547px 窄屏、滚动跟随/保护及键盘焦点；真实加载/错误等待 Agent 契约，不恢复教材/练习面板 |

各子步骤分别介绍、确认与审查；完成之前不创建下一步文件，开发记录编号由共享控制面协调。

## 阶段 F2：Electron 调用 Agent 与真实流式对话

### F2 范围与架构决策

正式链路采用独立 `Kernel Host（内核宿主）`，而不是 Renderer 直连模型，也不在 Electron Main 中复制一套 Agent。调用方向固定为：

```text
Renderer（渲染进程）
  → Preload Bridge（预加载桥）
  → Electron Main（桌面主进程）
  → Kernel Host（内核宿主，独立进程）
  → Agent Runtime（智能体运行时）
  → LLM/Tools/Session（模型／工具／会话）
```

依赖方向只朝公共契约：前端不得导入根目录 `src/**`，Renderer 不得获得模型地址、密钥、Node API 或原始 IPC 权限。Main 负责 Host 生命周期与请求路由；Host 负责 Agent、模型、工具和持久事实。参考 Harness 的原则是正文/reasoning 分离、请求具有相关 ID、取消贯穿同一逻辑流、无业务终止事件视为断流；其 baseline/journal 恢复、通用 Gateway、Waterfall 与多 Carrier 能力均延期。

### F2 最小产品范围

- 一个本地会话、纯文本、多轮对话、同一时刻最多一个生成请求。
- 展示真实正文增量；reasoning 不混入正文，第一版可关闭模型思考。
- 支持等待、生成、完成、停止、失败、Host 退出和输出截断状态。
- 工具默认为空集合，避免演示对话意外读写环境；后续单独开放 Agent 工具能力。
- 本阶段不做多会话列表、云同步、DAG、教材、Markdown/HTML、附件、工具过程 UI 或长期历史搜索。
- “打字机效果”首先忠实消费真实 delta；只有实测突发过强时才加有上限的显示缓冲，不延迟完成语义。

### F2 实施步骤

| 状态 | 子步骤 | 所有者与目标文件 | 工作内容与完成标准 |
|---|---|---|---|
| ✅ | F2.R Qwen 流式可行性调研 | 前端只读调研；记录于开发记录 | 已确认 Pi 的 `local-vllm/qwen3.8-27b` 使用 OpenAI Chat Completions SSE；正文可产生真实增量；未输出密钥或改服务器 |
| ✅ | F2.1 通用 Stream RPC MVP 与 Agent 契约 | **共享控制面，由本 Step 唯一写入**；`rpc/**` | 已实现无框架依赖的 `v1` open/item/end/error/cancel、双向运行时校验、StreamRpcClient/Server/Router、NDJSON 分帧与 `agent.turn`；只做请求对应流式响应，不做 unary、snapshot、重连或多会话并发 |
| ⛔ | F2.2 Backend Kernel Host 与真实模型 | **后端 Agent**；后端计划和后端所有权文件 | 提供可由 Electron 启停的 Host 入口、Qwen Adapter 与 `agent.turn` Handler；凭据只在 Host；工具默认禁用；按 started/delta/唯一终态输出并通过断流/取消测试后解除前端阻塞 |
| ⬜ | F2.3 Main Host 生命周期与传输 | 前端 Agent；`frontend/electron/**` | Main 启动并监督 Host，通过 stdio NDJSON 收发帧；实现单实例、启动失败、退出、崩溃、窗口关闭取消、stderr 日志脱敏和请求路由；不在 Main 解释 Agent 私有事件 |
| ⬜ | F2.4 Preload 最小安全桥 | 前端 Agent；`frontend/electron/preload.ts`、`frontend/src/env.d.ts` 及前端协议适配文件 | 仅暴露开始一个 Agent Turn 流与取消，并将已校验事件投递给 Renderer；订阅返回 cleanup，Renderer 无权构造任意 RPC method/channel |
| ⬜ | F2.5 Renderer 对话状态内核 | 前端 Agent；`frontend/src/workspace/**` 内按职责拆分 | 用 reducer/状态机管理本地用户消息、助手占位和 delta；按当前请求隔离迟到流，只允许一个在途 Turn；完成、取消、失败后保持部分正文并进入明确终态 |
| ⬜ | F2.6 流式对话界面 | 前端 Agent；`frontend/src/workspace/**` | Composer 调用 Agent；MessageList 展示用户/助手消息、等待与流式光标；发送中切换停止按钮；自动滚动仅在用户位于底部附近时跟随；纯文本安全渲染 |
| ⬜ | F2.7 错误与桌面验收 | 前端 Agent；`frontend/**` 测试/验证文件 | 覆盖 Host 启动失败、拒绝、超时、断流、截断、取消竞争、终态后帧和窗口关闭；Electron 实机验证中文 IME、长回答、滚动与停止，不以浏览器或 build 代替；恢复/重连延期 |

### F2.1 已确定的 MVP 契约

1. **范围：** 通用 RPC 核心与 Electron、React、Cordis 解耦；Electron stdio 只是后续第一个 Transport。MVP 仅支持 `stream()`，每个请求获得一条响应流。
2. **相关性：** `id` 只关联 RPC 逻辑流；`agent.turn` 输入另带 `requestId/sessionId`，首个业务事件由 Agent 提供 `turnId`，不混用身份。
3. **顺序：** Agent 流必须 `started → text-delta* → completed/cancelled/failed/truncated`；恰好一个业务终态，缺失终态或终态后继续输出均无效。
4. **取消：** `cancel(id)` 在 Server 转为对应 Handler 的 `AbortSignal`；Client 本地立即以 cancelled 结束并忽略迟到帧，Handler 后续负责形成业务取消终态。
5. **错误：** `RpcFailure` 仅含稳定 `code/message/details`；RPC error 表达协议/路由/传输失败，Agent `failed` 表达业务失败，可抛出 `RpcError` 与可序列化 Failure 分文件。
6. **校验与尺寸：** Client/Server 均校验精确字段、协议版本、ID、方法、JSON-safe 值和 Agent 输入输出；单帧上限 1,048,576 字符，输入 32,768 字符，单 delta 16,384 字符。NDJSON 支持半行、多行和无结尾换行。
7. **明确延期：** snapshot/cursor、持久事实恢复、hello/capabilities、普通 unary、重连补洞、工具与 reasoning 均在实际需求出现后独立扩展，不让 MVP 预付复杂度。

### 后端 Agent 交接清单

前端开始 F2.3 前，需要后端 Agent 明确交付：Host 启动命令、共享 Stream RPC `v1` 接入、Qwen 凭据解析、真实 Agent Runtime 调用、正文 delta、唯一终止/失败映射、Abort 贯穿、默认空工具集合，以及可脚本化的 Mock Host。后端任务及状态应由后端 Agent写入 `_docs/backend-plan.md`；前端不代写、不直接复用后端私有 Store 或 Cordis 事件。

### 验收门槛

F2.1 已串行完成，F2.2 后端契约测试通过后才进入 F2.3；F2.3–F2.5 可在 Mock Host 上开发，F2.6 接真实 Host，F2.7 完成后才把真实对话设为默认桌面入口。任何“临时 Main 直连 Qwen”只能作为隔离实验，不能代替上述正式链路。

## 4. 当前下一步

**F2.1 通用 Stream RPC MVP 已完成。** 下一步是将 F2.2 交给后端 Agent：在其计划中安排 Kernel Host、`agent.turn` Handler、真实 Qwen Adapter 与可脚本化 Mock Host。后端满足共享 `rpc/` 契约并通过取消/断流测试后，前端再进入 F2.3；不使用 Main 直连 Qwen 绕过 Agent Runtime。
