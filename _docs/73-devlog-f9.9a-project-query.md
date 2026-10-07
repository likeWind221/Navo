# 73：F9.9a 项目查询与创建

## 做了什么

- 用户确认 F9.9 分三个子 Step 依次进行（a 查询与创建，b Human 操作入口，c 变化跟随），方法名统一带版本后缀；本记录对应 F9.9a。
- 共享契约 `rpc/project.ts` + `rpc/project/validation.ts` 新增 5 个方法：`project.list.v1`、`project.create.v1`、`project.get.v1`、`project.mailbox.v1`、`project.resources.v1`。DTO 是纯 JSON 公共类型，两端 `exactKeys` 严格校验，每个方法恰好返回 1 个 item。
- 既有 `agent.turn` 更名为 `agent.turn.v1`，只改线上方法名，导出符号 `agentTurnMethod` 不变，前端通过共享 `rpc/` 自动跟随，无需改 `frontend/**`。
- `StreamRpcServer` 在 Handler 抛出带 `failure` 的 `RpcError("remote-error")` 时原样转发该失败；其他异常仍为 `stream-failed`。客户端原本就把 error 帧还原成同样的 `RpcError`，两端对称。
- 领域：Project 增加用户命名 `name`（与 goal 独立）与 `createdAt`（取创建事件时间）；`ProjectStore` 增加 `list()` 与只允许 revision 1 的 `discard()`；`ProjectRuntime` 增加 `isMainActive`、`isNodeActive`、`nodeActions`。
- Host：`src/host/project.ts` 注册 5 个方法并负责领域对象到 DTO 的唯一转换；`src/host/project/failure.ts` 把 Project / Workspace 领域错误映射为公共失败码，未知错误记 stderr 并返回 `internal`。真实 Host 与 Mock Host 都已注册。

## 关键决策

- 版本按方法计。新增字段即出新版本，所以 `project.get.v1` 一次定型：`turnActive` 与 `actions`（run / complete / skip）在 F9.9a 就进入 v1，即使对应操作在 F9.9b 才开放，避免 F9.9b 立即升 v2。
- `actions` 由 `ProjectRuntime` 计算（它是“当前允许什么”的权威），只是提示，真正执行时仍会重新校验。节点 `status` 原样使用 NodeStore 五态，不把瞬时 `turnActive` 混入。
- 创建的原子性：先创建 Project，再绑定 Workspace，绑定失败则 `discard`。`discard` 只接受 revision 1 的 Project，Host 是唯一调用方。代价是两步之间的 await 窗口里列表可能短暂看到 `workspaceRoot: null` 的项目。
- Mailbox 按 `afterSequence` 游标分页，`limit` 1–100，Host 额外按正文字符预算（524,288）截页，保证单帧不超过 1 MB 上限；`nextSequence` 即下一页的 `afterSequence`。
- Resource 只返回元数据（含 Workspace 相对 `entryRef`），不返回正文；Human 在 F9.9 不能修改 Resource、ACL 或 Mailbox。
- 失败码集合 `ProjectFailureCode` 一次定义完整，F9.9a 实际只产生 `invalid-request`、`project-not-found`、`project-unavailable`、`workspace-conflict`、`workspace-invalid`、`internal`；Node / Roadmap 相关映射随 F9.9b 落地。
- DeepSeek Harness 参照 `packages/api/session-controller/src`：采用其 list / create / history 查询与执行、跟随分离的职责划分；不采用 search、fork、rename、selectModel、attachment，也不新增 `cancel` 方法（沿用 Stream RPC 的 cancel 帧）。

## 坑与发现

- 根 `vitest.config.ts` 只收集 `tests/**`，`rpc/tests` 需用 `pnpm exec vitest run --config rpc/vitest.config.ts` 单独运行，CI 当前不覆盖；本次已本机运行。
- `StreamRpcClient` 会先在本地校验入参，非法输入在客户端就抛 `RpcError`，不会到达 Host。
- 领域没有消息正文长度上限；超过契约 `262,144` 字符的单条正文会让输出校验失败并变成 `stream-failed`，属于已知边界。
- 本机 Node v24：`pnpm typecheck` 通过；`pnpm test` 80 文件 / 469 项通过；`rpc` 7 文件 / 43 项通过；`frontend` typecheck 通过、16 文件 / 113 项通过。未运行真实模型。

## 下一步

- Draft PR 等用户审核与 CI；合并后 F9.9a 标记 ✅，前端 F5.2 可开始接入。
- F9.9b：Main / Node Turn 流式执行与取消（`project.turn.v1`）、节点完成 / 跳过（`project.node.review.v1`）。
