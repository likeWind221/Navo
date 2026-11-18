# BUG-044～046：Main 文件读取、规划交接与 Node 顶部信息

日期：2026-11-17。状态：三项均已完成本机代码修复并通过定向检查；真实 Main 读取、规划交接复验和窗口人工验收尚未完成，暂不勾选。

## 现象与复现

- BUG-044：用户让 Main 规划“简历优化”项目时，Main 声明自己没有文件系统工具，无法读取 Project Workspace 中的简历原文，只能要求用户粘贴路径或内容。
- BUG-045：Main 成功创建 Roadmap 后直接结束，没有说明哪些 Node 已解锁，也没有提示用户应按依赖顺序分别启动 Node Agent 执行。
- BUG-046：打开 Node 工作页时，顶部重复显示节点状态、编号、标题、目标、完成标准与操作区；同一信息在 Main 会话已按用户要求移除，Node 页面仍保留。

## 已证实事实与根因

- BUG-044：Host 已注册 `read` / `write` / `edit` / `shell` 文件工具，Main 缺少读取能力不是工具未注册，而是 `createMainAgentProfile` 的 Main 专用工具白名单没有 `read`。
- BUG-045：`create_roadmap` 成功后只返回 Roadmap 内容，Main 系统提示也没有要求做 Node 执行交接，因此模型可以合法地停在没有下一步的规划结果上。
- BUG-046：生产 Node 分支仍渲染 `NodeDetails` 和独立 `NODE WORKSPACE` 标题；此前只清理了 Main 会话的顶部摘要。

## 修复内容

- BUG-044：当 Host 实际挂载文件工具时，Main 与 Main Review 的工具白名单仅增加 `read`，不增加 `write`、`edit` 或 `shell`。提示词要求 Main 在规划、注册资源或陈述文件事实前先读取 Workspace 原文，并说明读取不会自动发布为 Resource。
- BUG-045：`create_roadmap` 成功回执增加执行交接要求；Main 系统提示同时要求说明计划已落盘、当前可执行 Node、按依赖顺序打开并启动 Node，以及每个 Node 由独立 Node Agent 作为阶段性 sub-agent 执行。明确禁止声称 Node 已自动开始。
- BUG-046：正式 Node 工作页不再渲染 `NodeDetails`、编号或重复节点标题，默认和 Main 一样直接显示对话与输入框。验收、返工和复盘信息只在存在提交或复盘状态时通过独立的 `NodeReview` 面板显示；“执行对话 / Main 复盘”切换保留。

## 验证结果与边界

- 根目录 `pnpm typecheck`：通过。
- 前端 `pnpm --dir frontend typecheck`：通过。
- 后端定向测试：`tests/project/profile-resource.spec.ts`、`tests/project/session.spec.ts`、`tests/tools/roadmap/create-roadmap-receipt.spec.ts`、`tests/integration/project-agents.spec.ts`，4 个文件 11 项通过。
- 前端定向测试：`View.spec.tsx`、`Node.spec.tsx`、`runtime.spec.ts`，3 个文件 25 项通过。
- 实际 Electron 已观察到 idle Node 页面不再出现节点详情和重复标题，仅保留会话及视图切换。
- 尚未完成的新 Main 真实模型验证：DeepSeek 请求中实际出现 `read`、Main 成功读取 Workspace 文件，以及新规划回复包含 Node 启动交接。
- 当前只重启了开发版 Host，确认输出 `[kernel-host] ready`；未运行完整前后端测试、受控 Electron QA、真实规划闭环或 CI。

## 后续

在 F5.6b 收口前使用新项目或新增规划回合复验 BUG-044 / 045，并完成 Node 提交后的验收面板人工检查。确认实际工具列表、Main 回复和 Node 页面效果后，再更新关闭条件与勾选状态。入口：[Bug 跟踪表](bug-plan.md)。
