# F5.6a Node 对话与执行

## 做了什么

- 项目运行时现在按 `main` 与 `node:<id>` 分别保存对话、草稿、活动请求和取消状态。切换 Main / Node、关闭后重新打开节点不会把内容串到其他目标，也不会因界面切换取消正在执行的节点回合。
- Node 工作页接入正式节点详情和对话区。输入与发送只在该节点快照的 `actions.run` 为真时开放；锁定、已交作业、执行中等状态显示对应说明，忙碌回合仍可停止。
- 节点回合通过既有 `project.turn.v1` 的 `{ kind: "node", nodeId }` 目标发送；`project.follow.v1` 继续由项目运行时统一持有，节点状态变化直接刷新地图与详情。
- 新增受控 Electron QA，覆盖 Main 规划生成两个节点、Main / Node 草稿隔离、节点执行状态变化、切换不取消、只停止节点、锁定输入、无隐式回合和 547px 无横向溢出。

## 关键决策

- 项目级详情与 follow 留在 `ProjectRuntime`，目标级回合状态拆到 `runtime/turns.ts`。这样 follow 仍只有一份项目订阅，而回合路由、草稿和取消按目标所有权管理。
- `project.turn.v1` 启动确认前可能先到达事件或错误。事件按 `requestId` 归属；错误在确认前按项目内唯一待确认目标绑定，多个待确认目标时暂存到操作号，确认后只应用到对应目标。
- 节点界面只消费后端快照的 `actions.run`，不根据 `idle` 或前端状态推导执行权限。跟随事件、节点解锁和切换都不会触发回合。
- 本次未修改后端、RPC、共享契约、Electron IPC 或 preload；受控 Host 只用于前端验收，不调用真实模型。

## 坑与发现

- 原先的 `ProjectRuntime` 把 Main 对话和项目详情放在同一个状态容器里，无法安全承载多个 Node 的独立回合；拆出 `ProjectTurns` 后，迟到事件、确认前错误和切目标取消都有独立归属。
- 首次 QA 在窄屏等待条件上耗尽了测试窗口时间；改为记录实际 renderer 宽度并同时断言 `innerWidth <= 547` 与 `scrollWidth <= viewport`，最终实测为 547 / 547。产品代码未因此修改。
- `frontend/scripts/qa/node.ts` 保持单条线性验收流程，包含本地选择器、等待和截图 helper。它只服务本次证据，未抽成通用 QA 框架；单文件超过通常阈值是因为流程、断言与证据必须按执行顺序集中审查。

## 验证结果与边界

- 前端：`pnpm --dir frontend typecheck`、`pnpm --dir frontend test`（33 文件 / 192 项）、`pnpm --dir frontend build` 通过。
- 受控 Electron：`pnpm --dir frontend qa:node` 通过，证据为 `%TEMP%/navo-f56a-qa/f5-6a-node.json`、`f5-6a-node-wide.png`、`f5-6a-node-narrow.png`；记录 4 个受控回合、0 次模型调用。
- 回归：`NAVO_HOST_MODE=controlled pnpm --dir frontend qa:main` 通过，证据为 `%TEMP%/navo-f54-evidence-1794915664289/f5-4-controlled.json`。
- 后端：Node 24.22.1、System32 优先，`pnpm typecheck` 与 `NAVO_TEST_MODE=all pnpm test --maxWorkers=4` 通过，188 文件 / 1166 项，328.30 秒；日志 `%TEMP%/navo-f56a-full.log`。
- 未验证真实模型节点行为，也未执行节点作业提交、人工确认、返工、跳过或 Main 复盘；这些属于 F5.6b。当前运行期间的界面保留不等于跨重启历史恢复。

## 下一步

- F5.6b：展示作业摘要、产物、逐条自查、未完成事项和返工意见，接入确认 / 返工 / 跳过 / Main 复盘操作，并保持版本冲突与待复盘状态的公开事实。
