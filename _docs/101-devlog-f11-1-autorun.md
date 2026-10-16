# F11.1 AutoRun 最小自动推进闭环

> 日期：2026-10-16  
> 状态：🔄 代码与 GitHub CI 已通过；本机完整验证未完成，PR #67 尚未合并。  
> 基线：`master` `38c142c`；开发分支 `phase11-f11.1-autorun`。

## 做了什么

- 新增 `src/project/autorun.ts` 的 `AutoRunService`：Human 在 Core 发起一次 AutoRun，顺序选取 Roadmap 中 `idle` 节点，复用 `ProjectRuntime.startNode/continueNode` 驱动同一个 NodeSession 的多个 Turn。
- Node 通过已有 `submit_completion` 进入 `submitted` 后，自动调用 `ProjectRuntime.startReview`，Main 的 `submit_review` 仍是唯一完成判定；complete/skip 交给 Roadmap 原有解锁逻辑，rework 继续原 Node Session。Main Review 可以在复盘过程中使用既有 Roadmap Mutation 工具重新规划，AutoRun 在每轮决策后重新读取权威 Roadmap，因此新增或调整的后续 Node 会自然进入下一轮调度。
- 同一 Project 防止重复 AutoRun；遇到 escalation、缺少 Review 判定、非 completed Turn、Project 不可用或执行对象占用时终止最小循环。已有 Human Runtime API 保持不变。
- 在 `src/app.ts` 接入插件，`src/project/errors.ts` 增加独立 AutoRun 错误码；新测试覆盖单 Node 多 Turn、依赖链、返工、去重、取消、缺失规划、复盘升级与未决。

## 关键决策

- Auto Driver 只负责下一 Turn 的确定性调度，不创建第二套 AgentRuntime，也不直接写 Roadmap/Node 领域事实；Roadmap 的认知性修改仍由 Main Agent 通过既有规划工具完成。
- F11.1 使用顺序 await 循环，不实现 F11.2 的复杂暂停/恢复、回合预算与重启状态机；不增加 RPC / Host / 前端契约（F11.3）。
- Main Review 原样复用既有权限，允许 Main 在 AutoRun 中根据新证据修改 Roadmap；AutoRun 不绕过 Main 直接规划。

## 关键机制与发现

- 必须在 Review Turn 收口后重新读取 Node `lastReview` 与 `reviewedRevision`，不能仅凭 Turn `completed` 判定完成。
- `escalate` / 未作决定需要终止自动推进，否则 submitted Node 可能触发重复 Review。
- AutoRun Service 生命周期取消信号向既有 ProjectRuntime 传递；对外主动暂停/恢复和失败分类仍属 F11.2。
- Main 重新规划后必须重新读取 Roadmap，而不能继续使用上一轮的 Node 列表；新增 Node、依赖调整和顺序变化都应由下一轮调度自然生效。
- 新增回归场景已验证：Node A 交作业 → Main 在 Review 中新增 Node B → Main 完成 Review → AutoRun 自动发现并执行 Node B。

## 验证与下一步

- PR：<https://github.com/likeWind221/Navo/pull/67>。
- GitHub Actions CI #271（`38865121414`）：`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test` 均通过。
- 当前执行环境缺少依赖且无法访问 GitHub / npm，尚未完成本机同等检查，因此保持 🔄、不合并 `master`。
- 当前不再把 Main 的 Roadmap 修改权限作为 F11.1 阻塞项；它是 AutoRun 自主重规划闭环的必要能力。F11.2 随后补齐预算、暂停/恢复、异常与重启语义。
