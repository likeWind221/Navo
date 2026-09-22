# 66：F9.7c 异常恢复与执行收口

## 做了什么

- 用户要求继续下一 Step，等整个 F9.7 完成再合并。本次据此在未合并的 F9.7b 上建立独立分支 `phase9-f9.7c-runtime-recovery`；F9.7b 暂不合并，F9.7c 验证通过后再串行收口两个 PR。
- 新增 `tests/project/runtime/recovery.spec.ts`、`disposal.spec.ts`；扩展共用 `helpers.ts`。验证 Main / Node 的模型失败、工具失败、工具执行中取消、归档/重新打开、终态取消竞争、服务释放及重新装配。
- 修改 `tests/integration/resource-handoff.spec.ts`，使用 ProjectRuntime 完成“Node A 失败 -> 人工继续 -> 发布资源/报告 Main -> 人工确认并解锁 B -> 人工启动 Main 授权 -> 人工启动 B 读取”的真实领域服务链。
- 测试暴露释放缺陷后，修改 `src/project/runtime.ts`、`src/agent/runtime.ts`、`src/agent/response.ts`、`src/node/session.ts`、`src/roadmap/store.ts`，保证回合取消后的日志和领域收尾能够完成。没有新增生产文件，没有删除文件。

```text
Human start -> ProjectRuntime -> Session -> AgentRuntime
                    |                          |
                    |   failure/cancel/dispose |
                    v                          v
+--------------------------------------------------+
| F9.7c: FIX / VERIFY                               |
| abort -> await settlement -> close logs/end work  |
|       -> release reservation -> stable facts      |
+--------------------------------------------------+
                    |
                    v
          Human next Turn (no auto-run)
```

## 关键决策

- ProjectRuntime 的 `ActiveTurn` 保存 controller 和只表示收尾完成的 done Promise。释放流程先拒绝新请求，取消当前快照中的全部回合，再等待 done；`runReserved` 的 finally 先删除占用再完成 done。业务结果/错误仍通过原返回 Promise 交付，done 不吞掉或改写结果。
- Cordis 当前版本并行释放服务，不保证上层异步回合结束前服务仍可通过 Context 访问。AgentRuntime 保留原 SessionStore 用于回合/步骤日志；`acceptResponse` 在进入工具执行前保留 SessionStore/ToolService，`appendToolCall` 直接接收 SessionStore；NodeSession 在运行开始时保留 NodeStore 用于 endWork；Roadmap 协调闭包使用原 NodeStore 执行最后一次事件批处理。没有复制状态、绕过 revision/依赖规则或新增 fallback。
- 这些引用属于既有执行生命周期，不为已卸载服务开放新的执行入口。Node work-ended 继续经过现有 Roadmap 协调和 NodeStore 规则；通用 AgentRuntime 不增加 Project、Main 或 Node 概念。
- 归档禁止新 Turn，但不隐式中止正在进行的 Turn；仍可人工 stop。重新打开只恢复允许条件，不自动执行。工具失败仍回传模型，在同一个已授权 Turn 内继续推理，不把一次工具失败等同于整个 Turn 失败。
- 恢复指内存事实允许下的下一次人工回合，以及释放后的服务重新装配；不表示应用重启恢复。实现不包含超时强杀不合作的第三方工具，继续遵循现有 AbortSignal 协作取消协议。
- 参考 `deepseek-harness/packages/core/agent-loop/src/index.ts` 的 `FactoryOwnership.dispose`，采用停止接收、取消、等待已拥有工作的顺序；参考同目录 `agent.ts` 的 `kick` finally 收尾。本项目不移植其 factory/persistence、inbox 自动唤醒或 maintenance 调度；为当前 Cordis 的并行卸载保留必要收尾引用。

## 坑与发现

- 首轮失败证据：Runtime dispose 返回时两个活动回合均未结束；整应用释放时出现 `ctx.sessions.append` 和 `ctx.nodes.endWork` 访问 undefined，Main/Node Promise 被拒绝。修复后模型等待和工具执行两种关闭路径都产生唯一 turn-ended，步骤日志闭合、Node 恢复 idle、调用正常返回 cancelled。
- 搜索工具会把底层 Error 规范化成安全的工具错误；测试断言规范化结果，不要求泄露原始错误信息。取消与终态竞争测试在 finished 交付前取消，断言只产生一个取消终态。
- 本机 `pnpm typecheck` 通过；ProjectRuntime 与资源交接相关 32 项通过；完整 `pnpm test` 为 77 个文件、456 项通过。模型/搜索使用 Mock，领域状态、事件、工具执行和临时工作区文件走真实实现。
- [PR #29](https://github.com/likeWind221/Navo/pull/29) 的 [GitHub CI](https://github.com/likeWind221/Navo/actions/runs/35683317014) 通过，F9.7c 与 F9.7 标为实现和验证完成；未进行真实模型或桌面验收。

## 下一步

- F9.7c 整体验证通过后，F9.7b 已 squash 合入 master（8234a72）；F9.7c 已移到新的 master，文件内容与重排前完全一致，保留独立 PR。文档收口后的最终 CI 仍作为 F9.7c 合并门禁。
- 下一功能步骤是 F9.8 长程 Core 集成验收，本次不实施；Host/RPC/前端公共契约仍由 F9.9 交接，当前 F5.2 仍等待公共项目入口。
- 本次任务为计划、索引和开发记录的唯一写入者；F9.7b 导读已交付，本轮最终回复交付 F9.7c 模块地图、修复机制与实际验证边界。
