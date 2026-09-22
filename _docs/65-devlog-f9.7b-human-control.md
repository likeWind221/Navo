# 65：F9.7b Main / Node 人工执行控制

## 做了什么

- 用户确认本 Step 后，从最新 master `fa7ad21` 创建 `phase9-f9.7b-human-control`，带入最新计划分支的 F9.7 范围说明；不实现 F9.7c。
- 修改 `src/project/runtime.ts`：Main 首次及后续回合统一使用 `startMain`，Node 首次使用 `startNode`、后续使用 `continueNode`；增加定向 stop、可执行查询与人工完成/跳过入口。
- 修改 `src/project/errors.ts`，新增 Main 活动冲突与 Runtime 已释放错误。复用 MainSession、NodeSession、AgentRuntime、NodeStore，不修改其实现。
- 调整 `tests/project/runtime.spec.ts`，共用装配移至 `tests/project/runtime/helpers.ts`；新增 `lifecycle.spec.ts` 与 `review.spec.ts`，覆盖主从会话复用、互斥、定向取消和人工确认。
- 同步后端计划与索引；本任务作为唯一写入者串行更新索引，不修改前端文件或公共通信契约。

```text
Human action
     |
     v
+-----------------------------------+
| MODIFY: ProjectRuntime            |
| validate / reserve / cancel       |
+-----------------------------------+
     |                       |
     v                       v
Main / Node Session      NodeStore
     |                   confirm / skip
     v                       |
AgentRuntime                 v
     |                   Node facts
     v
Turn result -> release reservation
```

## 关键决策

- `activeMains` 按 Project、`activeNodes` 按 Node 持有本次调用的 AbortController。这是进程内占用，不是第二套领域状态机。`runReserved` 在调用 Session 前同步占用，合并调用方 signal，在 `finally` 中释放；同步抛错和异步失败均释放占用，不新增重试。
- `canStartNode` 现在仅表示首次启动；已有 Session 时应查询 `canContinueNode` 并调用 `continueNode`。后续回合同样检查 active Project、work/idle、当前 Roadmap membership 和本入口占用，不让底层 FIFO 把重复人工请求排队。
- Main 首次及后续回合都复用 Project 创建时的 mainSessionId；不新增 Main 持久状态。`canStartMain` 只是只读提示，实际 start 会重新校验。
- stop 只中止指定占用，不提前删除占用、不级联中止其他 Agent。重复 stop 或没有占用返回 false；Project 归档后仍允许取消已有工作。Runtime 释放时拒绝新操作并中止其拥有的回合，完整释放竞态矩阵留给 F9.7c。
- `confirmCompletion` / `skipNode` 校验 Project 归属及占用后交回 NodeStore；状态、reviewedRevision、confirmedBy、reason 的领域规则不复制。控制节点允许人工确认，不需要 Session。确认期间不重新要求 Roadmap membership，保留既有领域确认能力。
- Human 是调用来源约定，不是由 confirmedBy 文本完成身份认证；内部 Session 服务保留原有 API 和 FIFO。未来 Host/RPC 的人工入口必须使用 ProjectRuntime，本 Step 没有开放网络接口或新增安全主体。
- 对照 `deepseek-harness/packages/core/agent-loop/src/agent.ts` 的 `cancel`、`runMaintenance`、`kick`，采用活动级 AbortController、finally 清理和结束后可再次显式执行；对照同目录 `index.ts` 的 `FactoryOwnership.dispose`，由生命周期所有者发出释放取消。本阶段不移植 inbox wakeRequested、自动继续 driver、Agent factory/恢复事务或持久化。

## 坑与发现

- NodeSession 会先绑定 Session，再在微任务开始 working。人工确认必须同时检查 ProjectRuntime 占用，否则可在 start 与 working 之间抢先完成节点。
- Node 尚未进入 AgentRuntime 时取消，既有 NodeSession 返回 AbortError；进入 Runtime 后取消返回 `turn.status = cancelled`。本 Step 保留这两种已有结果，不伪造不存在的 Turn；前一种仍保留已绑定 Session，下次用 continueNode。
- 入口结构/状态错误同步抛出；经 `runReserved` 调用的 Session 错误以 Promise rejection 返回，调用方应统一用 try/await 捕获。
- 生产 runtime 文件 216 行，仍由同一 Project 控制边界负责；错误定义保留独立模块；测试按启动、生命周期、人工确认场景拆分，共用装配不进入生产。
- 本机验证：`pnpm typecheck` 通过；ProjectRuntime 相关 14 项测试通过；`pnpm test` 完整 75 个文件、439 项通过；`git diff --check` 通过。测试使用 Mock 模型，但实际经过 Session、AgentRuntime、NodeStore、RoadmapStore。
- GitHub CI 待 PR 执行；当前计划标为进行中，未合并。未进行真实模型或桌面验收，未证明 F9.7c 的模型/工具失败、归档及释放竞态完整矩阵。

## 下一步

- 创建 F9.7b PR，GitHub CI 通过后更新验证记录；按 AGENTS.md 向用户报告并确认合并。
- F9.7b 合入后再介绍 F9.7c 异常/恢复集成范围；本 Step 不修改 Host、RPC、前端，不实现自动调度、数据库或进程重启恢复。
- 公共 Project 操作协议仍待 F9.9，不把本地类型当作已冻结跨端契约。交付回复需提供本次代码导读；本记录不是导读的替代。
