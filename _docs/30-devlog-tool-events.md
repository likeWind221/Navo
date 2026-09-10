# F3.2.2：工具执行事件接通

## 做了什么

- `TurnOutput` 缓冲模型分片产生的工具名称与原始参数，在模型结束原因允许接收调用时输出完整工具内容，再输出实际执行和结果事件。
- `ToolService` 在白名单、工具存在性与参数校验通过后，通过 `onStarted` 报告即将进入工具函数；执行前失败不会伪造开始事件。
- `acceptResponse` 在工具结果写入 Session 后发布公开结果；max-token 下已完成但禁止执行的调用也会得到明确失败结果。
- `agent.turn.v2` 的 Host 与 RPC 没有新增工具转换，继续原样转发并使用既有状态机校验。
- `AGENTS.md` 要求每个 Step 开始时用纯 ASCII 流程图展示完整主流程，并明确标出本次修改区段。

```text
ModelEvent tool fragments
          |
          v
+---------------- F3.2.2 ----------------+
| TurnOutput: assemble name + arguments   |
|      |                                  |
|      v                                  |
| content-started/delta/completed         |
|      |                                  |
|      v                                  |
| ToolService validation                  |
|      | accepted          | rejected     |
|      v                   v              |
| tool-started        tool-result failed  |
|      |                                  |
|      v                                  |
| tool-result success/failure/cancelled   |
+-----------------------------------------+
          |
          v
Host pass-through -> RPC validation -> frame
```

## 关键决策

- `ModelEvent` 没有独立的工具名称结束信号；工具名称可能跨多个 delta，因此公开 `content-started` 延迟到模型 finish 后，避免发布不完整或猜测的 `toolName`。参数仍保持原始字符串，不在观察链路解析 JSON。
- content-filter、模型错误、取消和不完整流不会公开尚未被内核接受的工具调用。已公开调用必须在 Step 完成前结算；执行前拒绝可以直接失败，执行成功必须先出现 `tool-started`。
- 工具结果的完整文本继续保存在 Session；公开 `summary`、`detail` 和 `DisplayFailure` 只使用模型可见文本并按共享契约截断，不暴露工具异常的私有堆栈。
- 工具权限仍由 `AgentRuntime` 输入的已解析白名单负责。普通 RPC 回合默认空集合，F3.2.2 没有重新引入 RPC 工具清单。
- 工具仍按现有顺序串行执行。没有采用 Harness 的并行/独占调度池、prepare/finalize 扩展与结果元数据；这些不属于当前最小闭环。
- `output.ts` 保留为 303 行的单一输出状态机，因为正文与工具共同拥有 Turn 字符预算、事件预留、Step 关闭和回调发布状态；拆开会引入跨模块共享可变状态或第二套预算协调。Unicode 切片仍留在独立无状态 helper 中。
- 参考 `deepseek-harness/packages/core/agent-loop/src/tool-calls.ts`：采用准备失败与真实 dispatch 分离、调用与结果稳定关联、取消后为调用收敛结果；本项目通过现有 `ToolService.execute` 的单一开始回调实现最小边界。

## 坑与发现

- 工具参数内容一旦公开，RPC 状态机就要求它在 Step 完成前结算；max-token 和执行前取消不能只写 Session 而不发布结果。
- `summary` 与 `detail` 都计入 Turn 展示预算。输出器为每个已公开但未结算的工具预留事件槽和最少一个结果字符，避免正文或前序工具耗尽后续闭合空间。
- 重复 `toolCallId` 不会产生第二条公开调用链，防止 RPC 关联状态被污染；内核原有 Session 与执行行为未在本步骤扩大处理范围。

## 验证与交接

- 当前步骤 F3.2.2；授权范围为工具观察事件、必要工具执行边界、测试、后端计划、索引和 `AGENTS.md` 规则。
- 根工程构建以及根工程、RPC、前端类型检查通过；后端 34 个文件 242 项、RPC 6 个文件 42 项、前端 9 个文件 38 项测试通过。新增覆盖分片名称/参数、真实成功、白名单拒绝、执行中取消、max-token 未执行、长结果截断、Session 完整结果保留和私有异常隔离。
- 尚未运行真实 Qwen 或 Electron 实机；工具事件的前端卡片展示属于 F3.3-F3.4。
- 当前下一步为 F3.2.3 会话命令流与 `/hello` 命令；F3.2.4 Mock 场景与跨端交接仍未完成。
