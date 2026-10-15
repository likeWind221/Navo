# F10.4a 完成信号与待确认

## 做了什么

- Node 新增状态 `submitted`（待确认），以及两种事件：
  - `completion-signaled`：只能在 working 时写入，携带成果摘要、产物 Resource ID、逐条完成标准自查和未完成事项；
  - `rework-requested`：把节点从 `submitted` 退回 idle，记录要求方、返工意见和审阅时的节点版本。
- 已发出完成信号的回合结束（`work-ended`）后，节点进入 `submitted`，不再回到 idle。`completion-confirmed` 和 `node-skipped` 新增允许从 `submitted` 发起。下游解锁规则不变：`submitted` 不算终态。
- 新增 Node 专属工具 `submit_completion`（`src/tools/builtins/node/submit.ts`）：
  - 调用方身份取自可信的 Session 绑定；
  - 完成标准按 1 起的序号逐条覆盖，不能缺漏，也不能重复；
  - 产物必须是本节点可见的 Resource；
  - 成功后返回 `endsTurn`。
- 工具输出新增可选的 `endsTurn`。`acceptResponse` 遇到这类成功结果后：
  - 同一条模型回复中排在它后面的工具调用记为未执行（`turn-ended`）；
  - 本回合以 `completed` 结束。
  - 原有的 max-tokens 跳过逻辑与此合并为同一个 `skipCalls`。
- 返工意见保存在节点快照的 `pendingFeedback` 中，下一次 `work-started` 时清除。`NodeSessionService` 在回合开始时把它以 system reminder 形式附进用户消息，因此意见也会留在 Session 历史里。
- Node 提示词改为：完成时交作业，交完等待审阅；返工意见只是参考，目标和完成标准仍以 node-context 为准。
- `ProjectRuntime`：
  - 新增 `requestRework`；
  - `nodeActions` 增加 `rework`；
  - 确认完成和跳过允许 `submitted`。
- Roadmap 变更如果会让 `submitted` 节点的依赖不再满足，和 working 节点一样拒绝。
- 共享契约 `rpc/project.ts`（由后端作为本 Step 唯一写入者串行修改，方法版本不变）：
  - `NodeStatusV1` 增加 `submitted`；
  - `NodeV1` 增加 `submission` 和 `pendingFeedback`；
  - `NodeActionsV1` 增加 `rework`；
  - `project.node.review.v1` 的 `action` 增加 `rework`，这时 `reason` 字段即返工意见；
  - 两端严格校验。

## 关键决策

- **返工意见存在 Node 事件里，不走 Mailbox。** 这与 [78](78-devlog-f10-0-design.md) D10 不同，用户已于 2026-10-15 确认。原因有三：
  - D11 让 Human 也能要求返工，而 Mailbox 的发送方只有 main 和 node，Human 的意见会被错记成 Main 发出；
  - 存在 Node 事件里，意见与状态转换在同一事务内写入，并天然带版本；
  - F10.4b 的返工上限可以直接从 Node 事件数出。F10.4b 中 Main 要求返工时，写同一种事件，记录 `requestedBy: "main"`。
- **提交后硬性结束回合。** 参考 DeepSeek Harness（commit `d743267`）两处实现：
  - `packages/goal/tool-goal/src/index.ts`：用 id + revision 比较后写入完成状态；
  - `packages/subagent/subagent/src/structured.ts`：工具结果成功后才正式记录，并用单向守卫阻止完成后继续调用工具。

  采用的部分：版本校验、成功后才生效、完成后不再执行工具。不采用的部分：`tool-goal/src/wrapup.ts` 的软收尾，即注入提示、让模型再写一段结束语。Navo 的审阅以作业单为准，提交后继续行动会让作业单与实际成果对不上。
- **作业单保存完成标准原文，并按顺序对齐。** 投影器校验条数、顺序和文本都与当前完成标准一致，审阅时不需要再回查定义。确认完成或跳过后保留作业单，供展示；返工则清除作业单。
- **中断恢复无需改动。** 进程在提交后、回合收尾前退出时，F10.3 恢复流程补写的 `work-ended` 会让节点进入 `submitted`。完成信号已经写入就算有效，不因回合没有正常收尾而作废。
- **保留 Human 直接确认 idle 节点的能力**（F9 行为）。确认完成或跳过时同时清除未读的返工意见。

## 坑与发现

- 测试工具链中有两处需要单独挂载新工具：`tests/node/session.spec.ts` 和 `tests/project/runtime/helpers.ts`。否则 Node 的工具列表里包含未注册的工具，模型请求根本不会发出。
- 在 Git Bash 下运行全量测试时，`tests/llm/auth/*` 会失败，因为 GNU `whoami` 遮蔽了 `whoami.exe`。这与本 Step 无关，改用 PowerShell 运行即可全部通过。
- 根目录 `pnpm typecheck` 和 `pnpm test` 不包含 `rpc/` 自己的 tsconfig 和测试，需要单独运行 `tsc -p rpc` 与 `vitest --config rpc/vitest.config.ts`。

## 验证

- 根目录 `pnpm typecheck` 通过；`pnpm test` 104 个文件、649 项全部通过（PowerShell）。
- `rpc`：`tsc --noEmit -p rpc` 通过；`vitest run --config rpc/vitest.config.ts` 46 项全部通过。
- `frontend`：`pnpm typecheck` 通过；`pnpm test` 21 个文件、135 项全部通过。前端未修改。
- 新增测试覆盖：
  - `tests/node/submission.spec.ts`：状态转换、作业单校验、返工版本校验与意见清除、真实关闭后重启恢复、中断恢复后的 `submitted`；
  - `tests/project/runtime/submission.spec.ts`：提交后回合立即结束且后续调用不执行、下游保持锁定、返工意见注入下一回合、再次提交后确认完成并解锁下游、三种非法作业单、Main 和非 working 状态调用被拒、跳过待确认节点；
  - `tests/host/project/turn.spec.ts`：RPC 展示作业单，以及返工的版本冲突与状态校验；
  - `rpc/tests/project.spec.ts`：新字段与 `rework` 动作的严格校验。
- 未执行真实模型验收，按计划与 F10.4b 的五个场景一起执行。
- 交付 PR：[#59](https://github.com/likeWind221/Navo/pull/59)，按当前 head 的必需 CI 通过后 squash 合入。

## 下一步

- F10.4b Main 复盘判定与计划调整，开始前按 Step 流程说明并取得确认。
- 前端展示交给 `frontend-plan.md`：待确认状态、作业单、返工输入、未读返工意见。
