# F3.1 公共事件契约

> 路径说明：本文记录 F3.1 完成时的实现。后续文件目录已重构，当前路径见 [实施记录](25-structure.md)；其中原 stream-rpc.ts 的保留说明已被本次按状态所有权拆分取代。

## 做了什么

完成 `agent.turn.v2` 的有序助手内容事件、`session.command.v1` 的独立命令响应流，以及两端的输入身份绑定、字段与生命周期校验。F2 的 `agent.turn` 和 RPC v1 帧保持兼容。本步骤的共享 `rpc/**` 与文档更新由本会话串行写入；没有注册真实 Host Handler，也没有修改 Electron/Renderer 生产代码。

### 模块与依赖

```text
StreamRpcClient / StreamRpcServer（流式客户端／服务端）
  → RpcMethod（方法契约，校验器接收本次已校验输入）
    ├─ content-stream（助手流状态机）
    │   → content-validation（助手字段校验） → content（事件类型与限制）
    └─ command（命令契约与状态机）
        → notification（会话通知校验） → content-validation（安全错误校验）
```

- `rpc/content.ts`：Turn/Step/Content/Tool 联合类型、身份作用域、可展示错误和尺寸常量。
- `rpc/content/validation.ts`：单个助手事件与安全错误的精确字段校验。
- `rpc/content/stream.ts`：公开方法、每次调用独立的助手状态机和有界 ID 集合。
- `rpc/notification.ts`：独立会话通知词汇及字段校验；普通通知可无 commandId。
- `rpc/command.ts`：命令输入、命令专属通知与有限响应流状态机。
- `rpc/protocol.ts`、`rpc/stream-rpc.ts`：Client/Server 向输出校验器传入已校验输入；旧的无参数工厂继续可用。
- `rpc/index.ts`：包级公共出口；内部实现直接依赖所有者文件，没有循环运行时依赖。

### 方法与兼容

| 方法 | 输入 | 输出 | 兼容策略 |
|---|---|---|---|
| `agent.turn` | 原 sessionId/requestId/text | 原 started/text-delta/终态 | 原样保留，F2 默认入口继续使用 |
| `agent.turn.v2` | 同 F2 输入与上限 | TurnEvent | 新方法显式选择，不向旧流注入新字段 |
| `session.command.v1` | sessionId/commandId/name/args | CommandNotification | 不要求 requestId 或 turnId |

所有方法继续使用 RPC `version: 1` 的 open/item/end/error/cancel 帧。旧 Host 未注册新方法时返回 `method-not-found`，桌面应明确显示不支持；不能自动把命令发成聊天或无声丢弃工具/reasoning。方法版本是业务词汇版本，独立于传输帧版本。

### ID 归属

| ID | 所有者与唯一性 | 关联规则 |
|---|---|---|
| RPC id | Client 生成，每条活动逻辑流唯一 | 仅关联传输、取消及响应；不当作业务 ID |
| sessionId | 已解析的 Host 会话，调用者引用 | 每个助手事件／通知必带，必须匹配输入 |
| requestId | 桌面生成，一次 Turn 调用唯一 | 助手事件必带，不代表模型内部的多次请求 |
| turnId | Host 在接受调用后确定 | turn-started 首次固定，后续事件完全一致 |
| stepId | Host 为每次可见模型请求确定，Turn 内不复用 | Step 顺序执行；已发布增量后不能用同一 Step 重试并追加重复前缀 |
| messageId | Host 为该 Step 的助手消息分配，Turn 内不复用 | 与 stepId 一对一；未提交时只是观察标识，提交时沿用该 ID 或由 Host 保持稳定映射 |
| contentIndex | Model Adapter 分配，每个 Step 内唯一 | content-started 的到达顺序决定显示顺序；可在下一个 Step 从 0 重新使用 |
| toolCallId | Host 规范化的工具调用标识，Turn 内不复用 | 与工具 contentIndex 固定配对；Provider 重复 ID 须由 Host 映射并保留后端关联 |
| commandId | 桌面为一次命令调用生成，不当作命令名 | 命令流必带，匹配输入；重试必须新建，不承诺幂等或 exactly-once |
| notification.id | Host 分配，Session 内唯一 | 一次命令始终使用同一 id，在时间线上原位更新 |

跨 Turn 的渲染键至少包含 sessionId/requestId/turnId；本校验器检查单条流内的唯一性，不承担全局会话注册表。通知没有 turnId/stepId/messageId 字段；一般通知可省略 commandId，但本次公开命令方法只接受有 commandId 的通知。

### 助手事件与顺序

- `turn-started` 固定本次 Turn；`turn-completed/cancelled/failed/truncated` 恰好一个终态。failed 携带安全 failure。
- `step-started` 固定 stepId/messageId；`step-completed` 要求本 Step 所有内容已结束、所有工具已有结果。正常 Turn 至少完成一个 Step，不能在活动 Step 中直接 completed。
- `content-started` 指定 kind 为 text/reasoning/tool-call；工具内容另带 toolCallId/toolName。所有内容支持 `content-delta { delta }` 和 `content-completed`。
- text/reasoning 的 delta 为正文／模型可展示思考；工具 delta 为原始参数文本片段，可为尚未完整的 JSON。校验器不解析参数、不执行工具；无参数调用可以没有 delta。
- 允许多个内容同时打开、按 contentIndex 交错追加；展示顺序取 content-started 顺序，不按 delta 到达时间重排。已结束内容不能再追加，正文—工具—正文需要新的 contentIndex 或新的 Step。
- `tool-started` 只允许工具参数块结束后发生，表示实际进入执行，不是参数生成。不同工具可同时执行。
- `tool-result` 关联原 Step/message/content/toolCallId；成功必须先 tool-started，失败或取消可以直接结束待执行调用，以表达参数错误、策略拒绝或执行前取消。结果允许交错到达，不能重复或关联未知调用。
- 工具结果为 status、纯文本 summary/detail；failed/cancelled 另带 failure。detail 可为空、按需展开，不向 Renderer 传递任意对象或私有堆栈。
- failed/cancelled/truncated 可从活动 Step／未完成内容／未结算工具中断，保留现有部分内容。后续 Renderer 应把未完成项标为中断或结果未知，不能伪造工具成功、完整结果或业务回滚。
- 任意解析失败后该校验器永久拒绝后续事件；无业务终态的正常 EOF 和终态后的事件均报错。

可执行顺序样例见 `rpc/content/tests/content.spec.ts`：reasoning → text → 两个交错参数工具内容 → 工具启动／结果 → 下一次模型请求正文 → Turn 完成。

### 命令通知与生命周期

输入 name 使用不带斜杠的小写名称，匹配 `[a-z][a-z0-9-]*`；args 是原样文本，可为空，具体语法由 Host Handler 校验。UI 在 F3.5 识别斜杠命令；未知但语法合法的名称送 Host 判定，不进入模型上下文。

输出都是 `type: notification`，含 id/sessionId/commandId/status/message。正常顺序为一次 running → 一次 succeeded/failed/cancelled → RPC end；准入前拒绝或取消可以直接 failed/cancelled。running 表示已进入处理，不保证产生副作用；succeeded 必须由真实 Handler 完成操作后发布。禁止重复 running、提前 succeeded、更换通知 id 或终态后继续更新。

每次命令使用独立的有限响应流；不增加底层无关联通知帧，不创建常驻订阅。当前普通会话通知只冻结类型，不声明已有全局推送通道。Client 的正常结束、异常、迭代器关闭、Abort 或 dispose 继续清理活动流和监听器；窗口所有者与 Preload 订阅 cleanup 由 F3.3 接入。

RPC cancel 延用现有语义：Client 立即停止等待、发送 cancel 并隔离迟到帧，Server 将其转为 Handler 的 AbortSignal。Host 只有确认尚未提交或已经协作中止时才能发布业务 cancelled；若已提交则以真实结果为准。本地 RpcError(cancelled) 不是业务撤销证明，后续 UI 应表达“已停止等待，执行结果未确认”，不能把它伪造成 Host 确认的 cancelled；断流、超时同样不能推断副作用不存在。本阶段没有恢复查询和自动重试。

F3 的默认业务准入策略冻结为同一 Session 的 Turn 与命令互斥：Host 在任何 await 前占用共同活动槽，成功、失败或取消清理完毕后释放。已有 Turn／命令时新命令返回 failed、code=`session-busy`，不发布 running、不执行；新 Turn 通过 turn-started → turn-failed(session-busy) 收敛。Main 可提前拒绝，但 Host 必须兜底；准入锁在 F3.2 实现，公共 RPC Router 本身不限制不同流并发。被拒绝的通知可与活动 Turn 的观察事件交错，UI 以本地首次接收顺序插入，不承诺跨流全局序号。

命令业务错误约定：`unknown-command`、`invalid-arguments`、`session-busy`、`command-failed`、`command-cancelled`；错误 code 保持可扩展，UI 不解析 message 驱动状态。传输、协议和不支持方法仍走 RPC error，不伪装成命令业务成功／失败事实。

### 校验与尺寸

| 内容 | 上限（JavaScript UTF-16 code unit） |
|---|---:|
| 各类 ID、工具名称、安全错误 code | 128 |
| Turn 输入文本、命令 args | 32,768 |
| 命令 name | 64 |
| 单 delta | 16,384 |
| 单内容累计 delta | 262,144 |
| 工具 detail | 65,536 |
| summary、通知 message、安全错误 message | 4,096 |
| Turn 累计 delta + 工具 summary/detail | 1,048,576 |
| 每 Turn Content / 全部业务事件数 | 1,024 / 65,536 |
| 原 RPC 编码后的单帧 | 1,048,576 |

Step 数不设置第二个业务上限，由 `AgentRuntime.maxSteps` 作为唯一事实源；RPC 的 65,536 总事件预算是独立的传输资源保护，统计 Turn、Step、Content 和 Tool 全部业务事件，使空 Step 与身份集合也有内存上界。Host 在发送前为已打开 Content、当前 Step 和 Turn 终态预留闭合事件；正文超过内容、Turn 或单帧预算时只截断展示数据，只有无法安全开始下一个 Step 时才停止 Runtime 并输出 `resource-limit-exceeded`。模型以 max-tokens 结束仍输出 turn-truncated。工具的大结果在 Host 转为有界展示摘要／详情，完整业务结果仍以后端事实为准；本步骤不实现 spill 或详情读取 API。DisplayFailure 只允许 code/message，不接受 RpcFailure 的任意 details；Host 仍负责确保这两项本身已经脱敏。

状态机不累计正文，只保存字符计数和由事件总数约束的身份集合；普通事件平均 O(1)，Step 完成检查 O(本 Step 内容数)，总存储 O(步骤数 + 内容数)。

## 关键决策与 Harness 对照

- 核对 `deepseek-harness/packages/core/agent-loop/src/agent.ts`：保留正文/reasoning 分离、多次模型请求和中断前缀。这里用显式 Turn/Step/Content 观察事件，不照搬内部 chunk 日志。
- 核对 `deepseek-harness/packages/core/agent-loop/src/tool-calls.ts`：参数准备、实际调度和结果归属分开，失败或取消可能发生在调度前。这里允许不同工具结果按发布顺序到达；不新增 Harness 并行池或调度器。
- 核对 `deepseek-harness/packages/core/session/src/index.ts` 的 post-commit session/event：已提交的工具结果／命令操作只在成功提交后发布事实观察；增量可先于提交，不能凭观察完成推断持久化。
- 核对 `deepseek-harness/packages/interaction/commands/src/types.ts` 的 command/run、command/done 与 commandId，以及 `packages/api/session-controller/src/commands.ts` 的 Host 命令所有权：命令反馈不进入模型上下文。这里采用独立命令响应流和明确 cancelled，不冒充 Harness 的现成 UI 线协议。
- 未引入持久化 chunk、Session 回放、Gateway、Waterfall、多 Carrier、通用命令注册系统或长期订阅。

## 坑与发现

旧输出校验工厂没有输入参数，单靠输出流内部 ID 一致不能拒绝第一帧串请求；现在 Client 和 Server 都绑定已解析输入并快照身份。工具参数可交错生成，因此不能把“同一时刻只有一个打开的内容”当作约束。取消与提交可能竞争，前端停止等待和后端取消事实必须区分。

## 验证

- `pnpm exec tsc --noEmit -p rpc/tsconfig.json` 通过。
- `pnpm exec vitest run --config rpc/vitest.config.ts`：4 个文件、42 项通过。
- `pnpm typecheck` 与 `pnpm --dir frontend typecheck` 通过。
- `pnpm --dir frontend test`：9 个文件、38 项通过。
- 测试覆盖新旧方法共存、输入身份两端绑定、多 Step／交错参数与结果、错误关联、缺失／重复终态、异常后关闭、尺寸累计上限、无 Turn 命令、取消透传和迟到成功隔离。
- 本次没有运行 Electron 视觉／真实模型验收，新方法尚未接入 Host 与 Renderer，不宣称桌面已获得 F3 功能。

## 下一步

F3.2 由后端所有者登记并交付新方法 Handler、稳定 ID 映射、受控工具列表、Session 准入互斥、至少一个真实命令以及确定性 Mock 场景。F3.3 可基于本契约和 Mock 开发桌面桥接与状态，必须遵守取消未知结果与首终态规则；最终实机验收仍等待真实 Host 交接。
