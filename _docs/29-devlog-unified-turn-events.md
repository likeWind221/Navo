# F3.2.1.3：统一回合观察事件

## 做了什么

- 唯一的 `TurnEvent` 定义位于 `shared/content.ts`，连同身份、展示错误和观察输出上限组成无运行时依赖的共享契约。`rpc/content.ts` 保留包级公共出口，`rpc/failure.ts` 复用展示错误类型；内核不导入 RPC 模块。
- 删除 Host 的 `V2Output` 和 `terminal.ts`，将 Unicode 切片辅助函数移到 `src/agent/output/split.ts`。新增内核 `TurnOutput` 直接接收 ModelEvent 与 start/startStep/endStep/finish 生命周期调用，不再定义中间 TurnEvent。
- Runtime 在 Turn 开始时创建输出状态，requestModel 将同一模型事件交给输出层；完整消息仍由 StepAccumulator 聚合。Session 提交 turn-ended 后，Runtime 才调用 finish 发出终态。
- v2 Host 只创建队列、转交同一个事件对象、传播异常并清理取消；v1 保留正文过滤和旧终态兼容。
- AGENTS.md 加入流程化、模块与实现最简化、改动代码不写解释性注释的规则。设计原因留在文档，必要校验和取消清理继续保留。

```text
Adapter -> ModelEvent -> collectStream
                            |
                            +-> StepAccumulator -> Message -> Session / Tools
                            |
                            +-> TurnOutput <- Runtime lifecycle / TurnResult
                                    |
                                    v
                         TurnEvent (shared/content.ts)
                                    |
                              Host queue
                                    |
                         RPC validator -> item frame
```

## 关键决策

- shared/content.ts 是可供任意观察者消费的业务契约，不含 RPC method、帧、异常类或后端私有依赖。RPC 保持 agent.turn.v2、传输 version 1、字段和校验器不变；公开工具事件变体继续保留，但实际工具观察输出仍待 F3.2.2。
- requestId 保留用于现有调用关联；Host 传入业务 requestId，其他内核入口缺省使用 userMessage.id。Step 开始时生成的 messageId 同时用于事件和 Session 消息。
- TurnOutput 使用逐次等待的回调，返回值保留 false 表示未发布的语义。requestModel 记录是否实际发布内容；仅未发布的失败尝试可以重试，beginAttempt 清理上一未发布尝试的内容索引。
- 内容生命周期、字符上限、事件预留槽和终态分类只有内核一个所有者。正文截断保留 Unicode 边界；单块展示预算耗尽不伪造模型 max-tokens 终态。所有实时观察者现在使用统一输出预算，包括旧 v1；内部完整消息不受展示预算影响。
- 当前工具参数生成和执行事件尚未公开；不为合并事件类型额外引入工具名分片缓冲。旧内部 tool-call 观察事件不再对外发布，工具执行和 Session 事实支路保持原有行为。
- 公共失败信息限制 code/message 长度，内部 TurnResult 保留原始失败；这只是字段选择与长度约束，不等同于对任意错误文本完成敏感信息脱敏。
- Host 队列在排空已接收事件后传播 Runtime 异常，RPC 按现有规则报告传输错误；Host 不伪造业务终态。消费者提前关闭 v2 流时 abort 内核操作后等待执行清理。
- 短文件 shared/content.ts 和 output/split.ts 分别拥有公共契约与 Unicode 切片边界；rpc/content.ts 是既有包级兼容出口。未创建额外事件总线、通用映射器或运行时策略注册框架。
- 参考 `deepseek-harness/packages/core/agent-loop/src/agent.ts:339-435`：模型流在 Step 内处理，完整消息由单个 assembler 形成，失败和重试由内核控制。本项目继续采用实时观察与完整消息双支路，不引入 Harness 的逐 chunk 持久化和回放元数据。

## 坑与发现

- 不能只把原 V2Output 移到内核并继续消费另一套 TurnEvent，否则只是移动第二次转换；因此改成模型事件和生命周期方法直接生成最终事件。
- 取消竞争测试原来用未命名 tool-call 触发内部观察回调。统一公开边界后改用正文开始触发，仍验证已发布内容后的外部取消优先于到期 deadline；残缺工具仍有独立不执行测试。
- 协议中 content-delta 不重复带 kind，旧版正文适配按 content-started 记录文本索引，Step 切换时清理，避免 reasoning 混入正文。

## 验证与交接

- 当前步骤 F3.2.1.3；授权范围为统一事件链路、必要共享契约与 AGENTS.md 规则更新。保留上一轮工具权限重构及用户已有工作区改动。
- 改动范围：shared/content.ts；rpc/content.ts、failure.ts；src/agent/types.ts、runtime.ts、request.ts、output.ts、output/split.ts；src/host/turn.ts、turn/v2.ts、turn/queue.ts；相关内核和 Host 测试；后端计划、索引和本记录；AGENTS.md。
- 根工程和 RPC 类型检查通过；后端 34 文件 236 项、RPC 6 文件 42 项、桌面 9 文件 38 项测试通过；桌面类型检查通过。
- 新测试直接用公共校验器消费 Runtime 输出，检查请求/消息身份、失败长度和取消闭合；Host 测试检查对象身份不变、异常传播及提前关闭取消。
- 尚未验收真实 Qwen 或 Electron 实机；没有实现工具生命周期、命令通道或前端 v2 UI。代码导读在本次最终回复交付。

## 下一步

- F3.2.2 在内核生成工具调用和执行观察事件，Host 继续原样传递；工具名称分片和参数完成时序在该步骤处理。
- 27 号记录是重构前历史，当前事件架构以本记录为准。前端计划的历史“下一步 F3.2.1”描述由前端计划所有者后续同步。
