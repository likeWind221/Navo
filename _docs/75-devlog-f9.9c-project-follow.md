# 75：F9.9c 变化跟随

## 做了什么

- 共享契约新增 `project.follow.v1`：入参 `{ projectId }`；打开后先推送一份完整基线 `{ detail: ProjectDetailV1, mailboxSequence, resourceRevision }`，之后每次该 Project 的已提交变化再推送一整份替换帧；前端取消流后停止推送。
- 领域新增 cordis 事件 `project/changed(projectId)`，只在各状态所有者的提交点发出：ProjectStore 创建、归档/恢复、丢弃；RoadmapStore 提交历史；MailboxStore 追加消息；ResourceStore 追加事件（通过 ResourceService 注入的回调）；ProjectRuntime 在 Main/Node Turn 预留和释放时各发一次。Node 状态变化继续复用已有的 `node/event`。
- Host 新增 `src/host/project/follow.ts`，并把 DTO 构造函数抽到 `src/host/project/view.ts`，供 `project.get.v1` 与 follow 共用，避免 `project.ts` 和 `follow.ts` 互相引用。

## 关键决策

- 推送整份快照而不是增量，与 DeepSeek Harness `session.follow` 的“基线 + 替换帧”一致。前端只需用最新一帧覆盖，不需要合并逻辑。
- Mailbox 和 Resource 列表可能很长，因此不放进帧里，只给 `mailboxSequence`（最新消息序号）和 `resourceRevision`（Resource 事件数）。前端发现数值变化后，再调用 `project.mailbox.v1` / `project.resources.v1` 拉取。
- 同一事件循环里的多次变化合并成一次计算：先标记 pending，再串行重算。内容与上一帧 JSON 相同就不发，比如其他 Project 的变化或纯内部事件。
- 事件只表示“某个 Project 变了”，不携带内容，快照仍以各 Store 为准，同一事实只有一个来源。监听器只做调度，不会让 Store 的写入失败。
- 跟随本身不改变任何项目事实，也不会启动 Agent。

## 坑与发现

- 客户端主动取消时，`StreamRpcClient` 会以 `cancelled` 拒绝当前的 `next()`；测试按此断言。
- `ProjectRuntime.runReserved` 增加了 `projectId` 参数，用于发出 Turn 活动变化，行为没有其他变化。
- 本机 Node v24：`pnpm typecheck` 通过；`pnpm test` 82 文件 / 478 项通过；`rpc` 7 文件 / 46 项通过；`frontend` typecheck 通过，16 文件 / 113 项通过。未运行真实模型。

## 下一步

- 三个 PR（#35 → #36 → 本 PR）依次审核合并，每次 squash 后把下一个分支 rebase 到 master。全部合入并通过 CI 后，F9.9 与三个子 Step 标记 ✅。
- 前端 F5.2 可以基于 `project.list/create/get.v1` 开始接入，地图实时刷新使用 `project.follow.v1`。
