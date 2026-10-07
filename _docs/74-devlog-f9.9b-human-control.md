# 74：F9.9b Human 操作入口

## 做了什么

- 共享契约新增 `project.turn.v1`：入参 `{ projectId, requestId, text, target: {kind:"main"} | {kind:"node", nodeId} }`，输出直接复用已冻结的 `agent.turn.v2` 内容事件。
- 共享契约新增 `project.node.review.v1`：入参 `{ projectId, nodeId, action: "complete" | "skip", reason, reviewedRevision }`，返回更新后的 `NodeV1`。
- `rpc/project/turn.ts`：输出校验器以首个事件的 `sessionId` 为准，再委托 v2 回合状态机校验身份、顺序和终止事件。原因是 Node 首次启动前前端并不知道 Session。
- `MainSessionService`、`NodeSessionService` 新增可选的 `requestId` 与 `onEvent`，并传给 `AgentRuntime.runTurn`；`ProjectNodeTurnInput` 改为扩展 `NodeSessionMessageInput`，不再重复字段。
- Host `src/host/project/turn.ts`：Main 走 `startMain`；Node 已有 Session 时走 `continueNode`，否则走 `startNode`。RPC 的 cancel 帧中止 AbortSignal，从而只取消这一个 Turn。复核接口固定 `confirmedBy: "human"`。
- 失败映射补充 NodeError：`stale-revision` → `revision-conflict`，`invalid-state` / `node-already-bound` / `node-session-required` → `invalid-state`，等等。

## 关键决策

- 开始与继续由后端根据是否已有 Session 决定，前端只需选择目标。
- 同一 Node 已有 Human Turn 时，Host 先返回 `turn-active`，与 Main 的同类错误一致；领域层原本对 Node 抛的是 `invalid-state`。
- 不排队、不新增 cancel 方法、不新增状态。Turn 进行中节点状态仍由 NodeStore 显示为 `working`，`turnActive` 单独返回。
- 回合在出第一个事件前失败（例如项目已归档、Node 被锁定）时走 error 帧并带稳定错误码；回合开始后，模型失败按 v2 的 `turn-failed` 事件结束。
- DeepSeek Harness 对照 `session.prompt` / `session.cancel`：采用“执行流 + 取消”的划分；取消复用 Stream RPC 的 cancel 帧，不单独设方法，也不实现 Harness 的 prompt 队列（Human Gate 要求拒绝并发而不是排队）。

## 坑与发现

- `createTurnOutputValidator` 需要预先知道 `sessionId`，因此包了一层，按首帧确定 Session。
- 本机 Node v24：`pnpm typecheck` 通过；`pnpm test` 81 文件 / 475 项通过；`rpc` 7 文件 / 45 项通过；`frontend` typecheck 通过，16 文件 / 113 项通过。未运行真实模型。

## 下一步

- F9.9c：`project.follow.v1` 先推完整快照，之后整份替换。
