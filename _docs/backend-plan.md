# SkillWorld 后端与 Agent 内核开发计划

## 1. 当前范围

阶段 0–5 已封包：提供商无关协议、Session 日志与 Surface、流式 LLM、工具服务、AgentRuntime、按 Session 串行的内部 Turn Inbox，以及“模型 → 工具 → 模型”闭环已经完成。

```text
阶段 6：NodeSession → 搜索调研 → 教材与练习内容
```

当前阶段按首个可见功能纵向实现 Node 学习内容：每个 Node 绑定一个持续 NodeSession；NodeAgent 搜索调研后提交纯文字教材和练习题，并在统一对话中继续答疑或修改内容。无状态批改、Evidence、Verification 与 DAG 等到对应功能切片再定义，不下沉到 AgentRuntime。

## 2. 开发方式

- 后端 Agent 只修改 `_docs/backend-plan.md`、根目录后端工程文件（`src/**`、`tests/**`、`scripts/**`、根 `package.json` 与根 `pnpm-lock.yaml`）及明确分配给后端的开发记录；不修改 `frontend/**`。
- 严格执行“一个 Step → 人工审查 → 确认后继续”。
- 每个 Step 开始前先说明目标、目标文件、改动内容和完成标准。
- 未经确认，不提前创建或修改后续 Step 的文件。
- 每个 Step 原则上只处理一个主要实现文件；测试文件作为独立 Step。
- 完成计划行时，按项目约定同步更新状态、开发记录和文档索引。
- DeepSeek Harness 仅作为只读参考，不修改 `deepseek-harness/`。

## 3. 状态说明

- ⬜ 未开始
- 🔄 进行中
- ✅ 已完成
- ⏸️ 延期
- ⛔ 阻塞

## 阶段 0：TypeScript 与 Cordis 工程骨架

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | 0.1 项目清单 | `package.json` | 声明 ESM、Node 版本、TypeScript、Vitest、tsx 和上游 `cordis` 依赖及最小脚本；不依赖 `@deepseek-ai/cordis` | 清单可审查；依赖使用精确版本；不引入 Agent/DAG 业务依赖 |
| ✅ | 0.2 TypeScript 配置 | `tsconfig.json` | 开启 strict、Node ESM、声明源码与测试编译范围 | `tsc --noEmit` 能读取配置；禁止隐式宽松类型 |
| ✅ | 0.3 安装依赖 | `pnpm-lock.yaml` | 使用约定的 pnpm 版本安装依赖并生成锁文件 | 安装成功；依赖版本被锁定；不修改参考源码 |
| ✅ | 0.4 最小入口 | `src/index.ts` | 创建空的 Cordis Context 启动与释放入口，为后续 Service 组合预留位置 | 入口可运行并正常退出；暂不注册 Agent 能力 |

## 阶段 1：提供商无关核心协议

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | 1.1 品牌化 ID | `src/brand/ids.ts` | 定义 Session、Message、Event、ToolCall 等品牌化 ID 及构造函数 | 不同 ID 在 TypeScript 中不可互换；运行时仍可序列化为字符串 |
| ✅ | 1.2 消息协议 | `src/llm/types.ts` | 定义 Message、text/reasoning/tool-call/tool-result 内容块、ToolSchema、FinishReason、TokenUsage 和 LLM 请求响应 | 不依赖具体 Provider；reasoning 可记录但不参与循环判断；tool call/result 可关联 |
| ✅ | 1.3 协议编译期断言 | `tests/protocol/core.typecheck.ts` | 用类型断言验证品牌化 ID、内容块关联和响应类型边界 | 类型检查通过；错误 ID 混用、缺失 error failure 均有编译期证据 |
| ✅ | 1.4 协议运行时样例 | `tests/protocol/core.spec.ts` | 用运行时样例验证 ID 构造、消息协议与 JSON 序列化 | JSON 数据可稳定构造；空 ID 被拒绝；品牌化 ID 运行时仍为字符串 |

## 阶段 2：SessionLog 与上下文投影

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | 2.1 会话事件协议 | `src/session/types.ts` | 定义 turn/step、user/assistant、request、tool call/result、error 事件及事件信封 | 事件由 type 判别；包含 session、sequence、timestamp；事件数据可序列化 |
| ✅ | 2.2 Session Store | `src/session/store.ts` | 定义 Cordis `ctx.sessions` Service、仅追加接口和内存实现 | sequence 严格递增；提交后不可变；先提交再发布事件 |
| ✅ | 2.3 Message Projector | `src/session/projector.ts` | 从事件日志投影模型 messages | 只投影 user、非空 assistant 和 tool result；相同前缀产生相同结果 |
| ✅ | 2.4 会话日志测试 | `tests/session/store.spec.ts` | 验证追加、顺序、不可变性和 Cordis 生命周期 | 注册、使用、释放均通过；监听器只看到已提交事实 |
| ✅ | 2.5 投影测试 | `tests/message-projector.spec.ts` | 验证模型可见与非可见事件边界 | 边界事件不进入 messages；工具结果顺序稳定；可从完整日志重建 |

## 阶段 3：LLM 与工具能力接口

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | 3.1 LLM Service | `src/llm/service.ts` | 定义 Cordis `ctx.llm`、Adapter 注册、路由和 generate 接口 | AgentLoop 不依赖 Provider SDK；支持 AbortSignal；注册可随插件卸载撤销 |
| ✅ | 3.2 Mock LLM Adapter | `src/llm/adapters/mock.ts` | 提供按队列返回响应的测试 Adapter | 可记录请求并确定性返回文本、reasoning 或工具调用 |
| ✅ | 3.3 流式 LLM 协议 | `src/llm/types.ts` | 参考 Harness 增加 block-start/delta/block-end/usage/finish 流协议；暂保留旧完整响应类型作为迁移桥 | Chunk 可表达文本、reasoning、多工具调用、usage 和终止原因；不持久化 chunk；现有代码仍可编译 |
| ✅ | 3.4 LLM 流式边界重构 | `src/llm/{service,mock}.ts` | 将 Service 与 Mock Adapter 原子切换为 stream-only；实现逐次迭代取消、错误终止和部分输出脚本 | 公共调用不再提供 generate；Adapter 接收同一 signal；Mock 可输出部分 chunk 后挂起/取消；无 timer/listener 残留 |
| ✅ | 3.5 流式 LLM 测试与旧协议清理 | `tests/{llm,streaming,errors,protocol}.ts`、`src/llm/types.ts` | 验证流注册、路由、块顺序、错误、卸载和调用中取消，并移除迁移期完整响应类型 | 流式边界具有稳定分类；旧 generate/GenerateResponse 不再存在；生命周期无残留注册 |
| ✅ | 3.6 Tool Service | `src/tools/service.ts` | 定义 Cordis `ctx.tools`、工具注册、Schema 查询、参数校验与顺序执行 | 未知工具、参数错误和业务异常都规范化为错误 tool result；注册可撤销 |
| ✅ | 3.6.1 Plugin 职责与文件规模修正 | `src/tools/{types,errors,schema,service}.ts`、`src/llm/errors.ts`、`tests/{llm,streaming,errors}.spec.ts`、`CLAUDE.md` | 拆分 Tool 协议/错误/Schema/执行和 LLM 错误，按行为拆分超长测试，建立手写代码 300 行限制与模块级 errors 约定 | 所有手写代码文件不超过 300 行；公开可抛出错误归属模块 errors.ts；行为和测试语义不变 |
| ✅ | 3.7 测试工具插件 | `src/tools/testing.ts` | 提供 echo、失败和延迟工具用于闭环测试 | 工具行为确定、支持取消，不进入生产默认组合 |
| ✅ | 3.8 Tool Service 测试 | `tests/tools/service.spec.ts` | 验证成功、未知工具、非法参数、异常、超时/取消和卸载 | 每个已接收调用都产生规范结果；错误不会破坏 callId 关联 |

## 阶段 4：Agent 步骤与轮次循环

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | 4.1 Agent Runtime 协议 | `src/agent/types.ts` | 定义 RunTurnInput、TurnResult、限制配置和状态类型 | API 不含 DAG 领域类型；终态明确区分 completed、blocked、cancelled、failed |
| ✅ | 4.2 单 Step 执行器 | `src/agent/step.ts` | 记录请求快照，调用 LLM，提交 assistant message，顺序执行工具并提交 call/result | 无工具时 completed；有工具时 continue；step/end 在所有路径恰好一次 |
| ✅ | 4.3 单 Step 测试 | `tests/agent-step.spec.ts` | 验证直接回答、单工具、多工具、工具错误和请求失败 | 事件顺序正确；工具调用与结果完整配对；失败无重复终止事件 |
| ✅ | 4.4 Turn Loop Service | `src/agent/runtime.ts` | 定义 Cordis `ctx.agentRuntime`，追加 turn 边界并循环执行 Step | 工具结果进入下一次请求；自然完成时停止；turn/end 恰好一次 |
| ✅ | 4.4.1 Session Surface 重构 | `src/session/{types,store}.ts` | 将模型消息 Surface、增量派生缓存和 replace 基础迁回 Session | Runtime 无消息缓存；原始日志保留；普通 append 增量派生，replace 后正确重建 |
| ✅ | 4.4.2 Runtime Step 合并重构 | `src/agent/runtime.ts` | Runtime 成为唯一 Session 写入者、模型流消费者与工具编排者 | 删除独立 Step/StepLog/model-response；Turn 行为测试覆盖完整事件序列 |
| ✅ | 4.5 终止保护 | `src/agent/{limits,runtime,types}.ts` | 实现可选最大 Step、模型超时、Harness 默认有限重试与统一取消辅助；工具时限由各工具参数 Schema 交给 LLM 填写 | 取消优先于重试；Runtime 不盲目重试工具；超限、截断和内容过滤返回稳定状态 |
| ✅ | 4.5.1 Runtime 分层简化 | `src/agent/{runtime,request,response,result}.ts`、`src/llm/collect.ts` | 将模型请求、响应接纳、纯结果构造和 LLM Chunk 归并移出 Runtime，并以 TurnScope 收拢 Turn 参数 | 源码模块名为单个职责词；Runtime 只保留编排；事件顺序与终止语义不变 |
| ✅ | 4.6 Turn Loop 测试 | `tests/{runtime,resilience}.spec.ts` | 验证多步闭环、最大步数、模型重试、超时、取消和异常收敛 | 所有退出路径日志闭合；Agent 调用结束后无后台任务残留 |

## 阶段 5：最小 Node 接入证明与验收

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | 5.1 最小组合入口 | `src/app.ts` | 组合 Session、LLM、Tools 和 AgentRuntime 插件 | Cordis 依赖自动激活；应用释放时所有 Service 和注册项正常撤销 |
| ✅ | 5.2 闭环集成测试 | `tests/integration/app.spec.ts` | 模拟“用户输入 → 模型调用工具 → 工具返回 → 模型最终回答” | 精确验证两次模型请求及完整事件序列；上下文可由日志重建 |
| ⏸️ | 5.3 Node 调用边界 | `src/node/agent.ts` | 延期：Node 应面向持续 Session，而不是包装单个 Turn；等待公开消息 Inbox 与领域边界设计 | 不以错误的单 Turn 抽象提前固化 Node 生命周期 |
| ⏸️ | 5.4 最小闭环验收 | `tests/node/session.spec.ts` | 随 5.3 延期；待 Node、DAG、Evidence 与 Verification 边界明确后重新规划 | 当前版本以 5.2 的内层 AgentLoop 闭环作为验收终点 |

## 阶段 6：Node 教材与练习内容 MVP

**阶段目标：** 围绕第一个可见学习功能完成纵向闭环：每个 Node 使用一个持续 NodeSession；NodeAgent 搜索调研后，以结构化领域操作提交教材与练习题，并在统一对话中继续答疑和修改两个内容面板。

**阶段验收场景：** 创建能力 Node 并绑定 NodeSession；用户开始学习后，模型调用搜索工具，依次提交纯文字教材和练习题；UI 可读取两个最新内容快照；用户随后在同一对话中要求修改教材或题目并保留上下文；另一个 Node 不读取该历史；取消当前 Turn 后仍可继续。

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | 6.1 学习产品契约收敛 | `_docs/00-skillworld-prd.md` | 明确技能学习应用、Node、MainSession、workspace 和 Agent 权限边界 | 产品术语与职责形成首版契约；后续由功能切片继续修订 |
| ✅ | 6.2 学习领域身份与协议 | `src/brand/ids.ts`、`src/node/model.ts` | 建立首版 Node、PracticeAttempt、Evidence 与状态轴协议 | 完成首版探索；其中尚未被功能验证的协议由 6.3.1 收回 |
| ✅ | 6.3 学习领域事件协议 | `src/node/events.ts` | 建立首版六类 NodeEvent，并确认其与 SessionLog 分离 | 完成首版探索；具体事件词汇由后续功能修正逐步收缩 |
| ✅ | 6.3.1 双 Workspace Session 与功能切片修正 | `_docs/{00-skillworld-prd,plan}.md`、`src/{brand/ids,node/types,node/events}.ts` | 探索双 WorkspaceSession 与 Learn MVP 方案 | 形成可审查方案；其双 Session 假设由 6.3.2 根据真实 UI 交互修正 |
| ✅ | 6.3.2 单 NodeSession 与内容面板修正 | `_docs/{00-skillworld-prd,backend-plan}.md`、`src/node/{model,events}.ts` | 将 learn/practice 从独立 Session 改为同一 NodeSession 下的教材/练习内容；将 Grader 定义为无状态 LLM 边界；再次收缩预实现协议 | 当前只保留 Node、单 Session 绑定和创建事件；计划围绕内容生成、修改和后续无状态批改组织 |
| ✅ | 6.4 Node Store 与单 Session 绑定 | `src/node/{errors,projector,store}.ts` | 定义 `ctx.nodes`；创建/读取 Node、绑定唯一 NodeSession、追加两类 NodeEvent 并重建快照 | revision 连续；事实不可变；Node 与 Session 一对一；事件不写入 SessionLog；观察者失败不回滚提交 |
| ✅ | 6.5 Node Store 行为测试 | `tests/node/store.spec.ts` | 验证创建、唯一绑定、跨 Node Session 占用、重建、损坏历史、观察者失败和 Cordis 生命周期 | 无模型调用；Store 边界确定；测试后无监听器残留 |
| ✅ | 6.6 教材与练习内容协议 | `src/brand/ids.ts`、`src/node/{model,events,projector}.ts` | 根据实际 UI 定义纯文字教材、来源、题目、隐藏参考答案、独立内容 revision、替换事实及严格投影 | UI 可直接读取当前快照；参考答案可从学习者视图排除；不从 assistant 文本解析领域内容；内容历史可严格重建 |
| ✅ | 6.7 Node 内容 Store 与受限工具 | `src/node/store.ts`、`src/node/tools.ts`、`src/{agent/types,agent/request,agent/response,agent/runtime,tools/types,tools/errors,tools/service}.ts` | 实现教材/题集替换命令；增加 per-turn 工具白名单和 `ToolExecutionContext.sessionId`，使内容工具按绑定的 NodeSession 授权 | 模型只看到本 Turn 允许的工具；内容工具只能修改调用 Session 所属 Node；结果不泄露隐藏答案；不允许跨 Node 写入 |
| ✅ | 6.8 Node 内容行为测试 | `tests/node/content.spec.ts` | 验证教材与题集创建、修改、重建、工具白名单、Session 来源授权、非法输入、取消和卸载 | 不解析自然语言；失败不留下半提交内容；无跨 Node 污染；既有 Runtime 工具闭环不回归 |
| ✅ | 6.9.1 搜索公共协议 | `src/tools/builtins/search/types.ts` | 定义请求、来源、结果、Adapter、注册撤销与可信配置 | 不依赖 Pi/Node/厂商；空结果合法；取消作为独立执行参数 |
| ✅ | 6.9.2 搜索错误协议 | `src/tools/builtins/search/errors.ts` | 定义本模块错误码及固定安全模型消息 | 内部 message/cause 与模型消息分离；超时和取消各自分类 |
| ✅ | 6.9.3 Adapter 注册与生命周期（历史，7.0 已收回） | `src/tools/builtins/search/service.ts` | 曾建立 ctx.search 与动态 Adapter 路由；阶段 7 根据实际单消费者边界删除该 Service | 历史行为已验收；当前以 7.0 的 SearchTool 构造时注入为准 |
| ✅ | 6.9.4 搜索执行与边界防护 | `src/tools/builtins/search/{types,service,validation,execution}.ts` | 执行委托、输入输出校验、有界复制冻结、取消与超时收敛 | 预取消不启动；迟到结果不接纳；不声称能强停不合作 Adapter |
| ✅ | 6.9.5 确定性 Mock Adapter | `src/tools/builtins/search/adapters/mock.ts` | 可编排结果、失败和取消，记录请求 | 离线确定性；不进入生产默认组合 |
| ✅ | 6.9.6 Exa HTTP Adapter | `src/tools/builtins/search/adapters/{exa,exa-response}.ts` | 核实官方接口后实现可信密钥注入、固定 HTTPS 请求与结果映射 | 拒绝重定向；有界读取；取消传播；安全错误；不重试 |
| ✅ | 6.9.7 搜索工具与模型输出 | `src/tools/builtins/search/tool.ts`、`scripts/search/smoke.ts` | 注册 web_search、Schema、结果预算与不可信内容标记 | 服从 per-turn 白名单；不写领域事实；注册可撤销 |
| ✅ | 6.9.8 Node 模块归并与命名统一 | `src/node/{model,events,errors,projector,store,tools}.ts`、`tests/{node-store,node-content}.spec.ts` | 将原 learning 模块迁入 node，统一 NodeStore/NodeError/ctx.nodes 及内部 node/event 通知 | 无旧源码引用；事件数据、版本、授权和算法不变；测试全部通过；不保留旧名转发 |
| ✅ | 6.10.1 Search 执行行为测试 | `tests/tools/search/execution.spec.ts` | 校验、冻结、取消、超时和安全错误；动态注册与路由测试由 7.0 删除 | 离线验证单 Adapter 的纯执行边界 |
| ✅ | 6.10.2 Exa 协议测试 | `tests/tools/search/adapters/exa.spec.ts` | 模拟 HTTP 校验认证、请求、响应字节限制、坏响应与取消 | 不依赖真实密钥；无真实网络请求 |
| ✅ | 6.10.3 Search 工具闭环测试 | `tests/tools/search/tool.spec.ts` | Schema、白名单、安全错误、输出预算与 Runtime 上下文 | 搜索结果进入下一次模型请求；无 Node 领域写入 |
| ✅ | 6.11 NodeAgent Profile | `src/node/profile.ts` | 注入能力目标、当前教材和当前练习题；要求先调研，再通过结构化工具提交内容 | 相同 Node 快照产生相同 Profile；不暴露其他 NodeSession；不允许修改 DAG 或宣布 mastery |
| ✅ | 6.12 持续 NodeSession Service | `src/node/session.ts` | 定义开始学习、继续对话和停止操作；创建或恢复单一 NodeSession，以限定工具集串行调用 AgentRuntime | 同一 Node 复用 Session；FIFO；不同 Node 隔离；取消只终止当前 Turn；Service 不直接写 SessionLog |
| ✅ | 6.13 NodeSession 行为测试 | `tests/node/session.spec.ts` | 覆盖开始学习、持续上下文、Profile、内容修改、节点隔离、FIFO、取消后继续、Runtime 失败和卸载 | 每条已执行消息对应闭合 Turn；当前内容被重新注入；无后台任务和悬挂 AbortController |
| ✅ | 6.14 分层应用组合接入 | `src/{app,agent/runtime}.ts`、`src/tools/plugin.ts`、`src/node/plugin.ts`、`tests/integration/app.spec.ts` | 将 Session、LLM、Tools、Runtime、Node 作为应用同层根模块；Tools 根内置 Search，Node 根收拢 NodeStore、内容工具与 NodeSession Service | `createApp()` 返回时五个根模块及其内部能力均已就绪；Node 通过 per-turn 白名单暴露工具；依赖按序激活并逆序释放 |
| ✅ | 6.15 内容生成端到端验收与收口 | `tests/integration/learning.spec.ts`、`_docs/10-devlog-phase-6-node-learning.md` | 从公开入口完成“开始 → 搜索 → 教材 → 练习题 → 对话修改”，并记录真实搜索 Adapter 和大文本存储的后续决策 | typecheck 和完整测试通过；NodeEvent 重建内容状态；NodeSession 重建对话；另一 Node 无法读取或修改二者 |

## 后续功能路线

- **阶段 7：Fetch 网页读取与调研闭环补齐**——阶段 6 先完成 Search 与基于搜索摘要的内容生成；紧接着增加独立 `web_fetch`，将调研扩展为“搜索 → 选择来源 → 读取正文 → 生成或修改内容”，优先于练习批改。
  - 代码归属：`src/tools/builtins/fetch/**`；与 Search 分离，不将 URL 抓取塞入搜索 Adapter，不从 Renderer 直接访问后端内部实现。
  - 输入与输出：接收用户提供或搜索发现的 HTTP(S) URL；仅在完整正文可在受限预算内取得时返回正文、最终 URL 和类型信息，超限返回稳定错误；首版考虑 HTML、Markdown 和纯文本，不做浏览器自动化或 PDF/二进制解析。
  - 安全边界：URL/协议校验、内网与特殊地址防护（IPv4/IPv6）、DNS 校验与连接目标一致性、逐跳重定向检查、响应类型及字节限制、正文输出预算、不可信内容标记；不可把搜索返回的 URL 直接视为可信网络目标。
  - 执行边界：贯穿取消、超时、错误归一化和资源释放；不自动重试，不承诺强制停止不合作实现。
  - 接入与验收：通过 ToolService 和 NodeAgent 白名单接入；Fetch 只返回外部资料，不直接写 NodeEvent；离线验证网络安全、提取、取消和“Search → Fetch → 内容提交”闭环。
  - 进入阶段时只读核对 Harness 的 Web Fetch Service/HTTP Provider/Tool 及本地 Pi web-access 实现，再确定协议、依赖和细分 Step，不提前创建生产文件。
- **阶段 8：Pi 式文件工具与网页结果留存**——在 Tools 根内并列加入 `read`、`shell`、`edit`、`write`，让模型在执行工作区中读取已知文件、通过命令探索和处理文件，并用同一工作区保存超长网页结果；不引入独立 `find` 工具或远程后端。
- **阶段 9：无状态练习批改 MVP**——以题目、参考答案和学习者答案执行一次无记忆 LLM 调用，返回结构化批改结果。
- **阶段 10：Attempt、Evidence 与 Verification MVP**——持久化作答和批改，收集可检查证据并形成 mastery verdict。
- **阶段 11：Main Agent 与 DAG**——从总体目标调研并创建能力图，消费节点缺口 proposal，进入规划、执行、验证和再规划外循环。

后续阶段只保留功能方向，不提前展开实现 Step；进入对应阶段前再依据上一阶段的实际接口拆分。

## 4. 阶段 6 非目标

以下能力不进入阶段 6（Fetch 网页读取已安排在紧接的阶段 7）：

- Main Agent 的 Goal 调研、Road Map 与 DAG 创建、版本化和调度；
- 除 Exa 外的其他真实搜索 Provider、网页全文抓取、MCP、搜索缓存与自动重试、RAG、来源质量评估、二进制教材 Artifact 与可视化画布；
- 学习者提交答案、无状态 LLM 批改、PracticeAttempt 和批改历史；
- Evidence、掌握判定、Verifier、跨节点再规划和间隔复习；
- 并行工具和独占屏障；
- 流式 chunk 全量持久化；
- 上下文压缩、surface replacement 和投影增量缓存；
- 通用的公开 Inbox、steering、inject 和 Session fork；阶段 6 只提供 Node-scoped 的 start/send/stop 入口；
- Node 间直接通信、长期 Tutor/Assessor 双 Agent、Web UI、数据库持久化和远程 RPC；
- Thought 文本解析或以自然语言思维链驱动状态机。

### 遗留能力：工具并发调度

后续为工具定义“并行安全”与“独占”分类；同一 Step 的并行安全调用可并发执行并等待全部完成，但 `tool-call-result` 必须始终按模型调用顺序提交。该能力需要补充副作用隔离、取消和顺序持久化测试，不纳入当前最小闭环。

## 5. 当前下一步

桌面跨端链路已完成 F3.2.4：内核能够执行工具与会话命令，Mock Host 已在独立进程中通过 stdio 提供回合与命令流；桌面侧下一步进入 F3.3 前端消费。阶段 8 采用 Pi 式 `read`、`shell`、`edit`、`write` 工具面；8.1 文件工具协议收口已完成，8.2.2 纯文本 Read Tool、8.2.3 Shell Tool 与 8.2.6 工具结果出口收口已完成，8.2.4 Edit Tool 与 8.2.5 Write Tool 已完成，当前下一步进入 8.3 Tools 根、Node 白名单与 Fetch spill 接入。命令架构与验收见 [命令框架开发记录](32-devlog-f3-2-3-command-framework.md) 与 [F3.2.4 开发记录](34-devlog-f3-2-4-mock-host-e2e.md)。

阶段 0–7 已完成。`web_fetch` 现作为 Tools 根内置的纯文本工具，由内部 FetchCore 组合安全 HTTP、公共网络策略和有界 HTML→Markdown；NodeAgent 通过白名单执行 Search→Fetch→内容提交，Fetch 结果只进入 SessionLog，NodeEvent 只记录最终教材与题集。阶段 7 专项测试 5 个文件、29 项通过，全项目 28 个测试文件、198 项通过；真实 `https://example.com` 冒烟在当前环境因 `blocked-url` 安全关闭，未绕过 DNS/代理返回的非公网地址。跨端 F2.2 已完成 Kernel Host、Qwen SSE Adapter、agent.turn Handler 和可脚本化 Mock Host。当前后端已完成 **8.1 文件工具协议收口**、**8.2.1 文件环境与文件目标**、**8.2.2 纯文本 Read Tool**、**8.2.3 Shell Tool** 与 **8.2.6 工具结果出口收口**；路径语义已按 DSH 执行环境规则修订，文件发现交给 `shell`，全部工具的结果出口已统一为单臂对象；当前下一步进入 **8.3 Tools 根、Node 白名单与 Fetch spill 接入**，桌面链路 F3.2.4 的 Mock Host 与端到端回归已完成，后续由前端进入 F3.3。

## 6. 阶段 7：Fetch 网页读取与调研闭环补齐

**阶段目标：** 在 Tools 根内增加不暴露独立 Cordis Service 的 `web_fetch`，让 NodeAgent 从搜索摘要进一步读取选定网页正文，再通过既有领域工具提交教材或练习题。

**阶段验收场景：** NodeAgent 依次调用 `web_search`、`web_fetch` 和 Node 内容工具；Tools 根内部的 FetchCore 只访问经过公共网络校验并固定连接地址的 HTTP(S) 目标，返回有界、不可信标记的 Markdown/文本；跨 Node 隔离与内容授权保持不变。

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | 7.0 Search Tool 边界收缩 | `src/tools/builtins/search/{types,errors,execution,tool}.ts`、`src/tools/plugin.ts`、`tests/{search-execution,search-tool,node}.spec.ts`、`scripts/search/smoke.ts` | 删除 ctx.search 与 SearchService；SearchTool 构造时接收单个 Adapter，执行与生命周期保持有界 | Cordis 只暴露 ctx.tools；动态 Provider 注册和路由删除；卸载取消在途搜索；完整回归通过 |
| ✅ | 7.1 Fetch 公共协议与错误 | `src/tools/builtins/fetch/{types,errors}.ts` | 定义请求、完整 HTML/文本正文、最终 URL、状态码与稳定安全错误；不定义 Adapter 或 Provider 协议 | 不依赖 Node、Cordis 或具体 HTTP 实现；模型消息不泄露网络诊断 |
| ✅ | 7.2 FetchCore 与校验边界 | `src/tools/builtins/fetch/{core,validation}.ts` | 实现内部普通 FetchCore、配置/请求/结果校验、有界复制冻结、超时、取消和迟到结果处理 | 不继承 Cordis Service、不暴露 Context 属性；预取消不执行；异常分类稳定；资源由一次调用拥有 |
| ✅ | 7.3 URL 与公共网络策略 | `src/tools/builtins/fetch/{policy,network}.ts`、`package.json`、`pnpm-lock.yaml` | 校验 HTTP(S)、凭据与长度；识别 IPv4/IPv6/NAT64 特殊地址；校验完整 DNS 集并固定实际连接地址 | 搜索 URL 不被直接信任；混合 DNS 与 rebinding 失败关闭；新增依赖精确锁定 |
| ✅ | 7.4 HTTP Fetch 实现 | `src/tools/builtins/fetch/{http,response}.ts` | 为 FetchCore 提供匿名底层读取函数；逐跳同源重定向、响应流读取、类型/charset/字节与字符限制、资源释放 | 不携带环境凭据；跨源重定向拒绝；只接收 HTML、Markdown 和纯文本；不重试 |
| ✅ | 7.5 Mock Fetch Core | `src/tools/builtins/fetch/mock.ts` | 提供确定性结果、失败、挂起与请求记录，作为工具和端到端测试替身 | 离线可复现；取消无 timer/listener 残留；不进入生产默认配置 |
| ✅ | 7.6 HTML 转换、输出格式与 FetchTool | `src/tools/builtins/fetch/{html,format,tool}.ts` | 将有界 HTML 转为 Markdown，移除非正文/隐藏元素，注册 `web_fetch` 并标记外部内容不可信 | 限制转换深度和最终输出；工具卸载取消在途读取；Fetch 不写 NodeEvent |
| ✅ | 7.7 Tools 根与 Node 白名单接入 | `src/tools/plugin.ts`、`src/node/profile.ts`、`tests/integration/app.spec.ts` | ToolsPlugin 内置 FetchTool 配置；NodeAgent 增加 `web_fetch` 白名单和 Search→Fetch 指令 | 不新增 ctx.webFetch；createApp 返回时工具就绪；其他 Agent 仍按自己的白名单选择工具 |
| ✅ | 7.9 Harness 风格完整正文语义 | `src/tools/builtins/fetch/{types,validation,response,html,format}.ts`、`tests/fetch-*.spec.ts` | 删除 Fetch 截断前缀；传输、解码、转换或模型输出超限均失败，只有完整正文才返回给 Agent | 不实现 spill 或 read；后续若引入，必须由独立临时结果存储与受控读取工具承担 |
| ✅ | 7.8.1 FetchCore 与网络测试 | `tests/tools/fetch/core.spec.ts`、`tests/tools/fetch/network.spec.ts` | 覆盖协议校验、冻结、IPv4/IPv6/NAT64、DNS、连接固定、取消和超时 | 不访问公网；安全策略和核心执行边界确定性通过 |
| ✅ | 7.8.2 HTTP 实现与工具测试 | `tests/tools/fetch/http.spec.ts`、`tests/tools/fetch/tool.spec.ts` | 覆盖重定向、响应限制、charset、HTML 转换、输出预算、白名单、卸载和错误脱敏 | 本地可控传输；二进制/过大/恶意 HTML 被拒绝或有界收敛 |
| ✅ | 7.9 调研端到端验收与收口 | `tests/integration/research.spec.ts`、`scripts/fetch/smoke.ts`、`_docs/18-devlog-phase-7-fetch.md` | 从公开入口完成 Search→Fetch→教材→练习题→修改，并记录真实 HTTP 冒烟与后续范围 | SessionLog 中 Fetch 结果有界；NodeEvent 只记录最终领域内容；完整测试和 typecheck 通过 |

## 7. 阶段 8：Pi 式文件工具与网页结果留存

**阶段目标：** 在 Tools 根内以 Pi 式工具面提供 `read`、`shell`、`edit`、`write`，让模型读取已知文件、通过命令探索和处理执行工作区、精确修改文本；共享同一工作区的多个 Session 可以访问同一文件，`web_fetch` 对已完整抓取但不适合内联的结果写入该工作区，再由 `read` 继续读取。

**阶段边界：** `ToolsPlugin` 仍只暴露 `ctx.tools`。执行工作区由宿主为 Session 固化为 `cwd`；相对路径以该 `cwd` 为基准，绝对路径按文件环境原样定位，不把工作区登记误当成沙箱。Session 不自动获得按 `sessionId` 划分的物理目录，共享同一 `cwd` 时访问同一文件。`read` 负责自身的路径目标解析、文件读取、文本识别和有界结果；`shell` 负责执行工作区命令，文件发现通过 Shell 完成，不再提供独立的 `find`。`edit`、`write` 提供结构化修改语义，但本阶段不保证 Shell 无法绕过它们直接修改文件；沙箱围栏、跨文件环境授权和真实用户目录的安全策略不在本阶段落地。本阶段不新增 `ctx.fs`、`FileCore`、远程/容器后端或通用二进制处理。

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | 8.1 文件工具协议与错误收口 | `src/tools/builtins/file/types.ts`、`src/tools/builtins/file/errors.ts`、`tests/tools/file/protocol.spec.ts` | 让 `read`、`write`、`edit` 拥有自解释的输入和稳定的文件错误，并移除模型层对独立 `find` 的依赖；文件环境中的相对/绝对路径语义继续由已完成的 8.2.1 承担 | 文件工具 Schema 与请求/结果类型一致；模型不能传入 `sessionId` 或工作区根；文件错误不再引导独立 `find`；不执行文件 IO；协议测试通过；`shell` 的输入、进程错误、超时和取消语义留在 8.2.3 |
| ✅ | 8.2 Pi 式工具实现 | `src/tools/builtins/{file,shell}/**`、`tests/tools/{file,shell}/**` | 让四个工具分别完成已知文件读取、工作区命令探索、精确编辑和完整写入；多个 Session 可共享同一 `cwd` 和文件，工具在共享文件与中断场景下返回明确结果 | 8.2.1–8.2.5 的工具行为均可独立验证；读取和命令输出有界；编辑与写入成功时完整收敛，失败不留下部分结果；不建立 Cordis Service |
| ⬜ | 8.3 Tools 根、Node 白名单与 Fetch spill 接入 | `src/tools/plugin.ts`、`src/tools/builtins/fetch/{format,tool}.ts`、`src/node/profile.ts` | 让 Tools 根按 Pi 式工具面组装四个工具；Fetch 在完整正文超过内联预算时写入当前 Session `cwd` 下的 `web/` 相对文件并返回预览和 `file_path` | NodeAgent 默认只获得 `read`；拥有同一 `cwd` 的 Session 可按相对路径读取 spill，其他 Session 按自身 `cwd` 解析；教材和题集仍只能通过 Node 领域工具修改；Fetch 不调用模型层 `write` |
| ⬜ | 8.4 文件工具与调研闭环测试 | `tests/{file-tools,fetch-tool,node-research-integration}.spec.ts` | 覆盖 `cwd` 解析、同一文件环境共享文件、相对/绝对路径、Read 分页、Shell 探索、原子写入、精确编辑、观察门禁、取消、卸载、spill 和 Search→Fetch→Read 闭环 | 同一 `cwd` 的 Session 能访问同一文件；不同 `cwd` 的相对路径不混淆；Shell 输出和 Read 结果有界；盲覆盖被拒绝且原子修改失败不留半成品；离线可复现；完整回归、typecheck 与 build 通过 |
| ⬜ | 8.5 文件并发与版本安全收口 | `src/tools/builtins/{file,shell}/**`、`tests/tools/file/*concurrency*.spec.ts` | 统一审查 Read、Edit、Write、Shell 参与文件修改时的竞态窗口，引入可比较的文件版本观察、stale 检测、create-if-absent 提交保护和必要的目标级串行化；Shell 作为非结构化副作用入口明确其失效/重读边界 | `read` 记录可比较版本；`write/edit` 基于已观察版本执行 optimistic guard；并发创建不会被静默覆盖；Shell 或外部修改能让旧观察失效而不是被结构化工具覆盖；仍明确不承诺跨主机分布式锁 |

### 8.2 实施子步骤

8.2 按 Pi 的四个模型工具依次完成下列子步骤；每个子步骤独立验证，8.2.2 内部再按下表的子步骤依次完成，8.2.2.5 完成后进入 8.2.3，8.2.6 收口工具结果出口后进入 8.2.4，8.2.5 完成后进入 8.3。文件环境继续采用 DSH 的执行环境思路：宿主为 Session 固化 `cwd`，路径解析和文件目标身份依赖该环境，Session ID 不自动形成物理路径命名空间；本次同步不再把“只允许相对路径”当成沙箱边界，沙箱策略留给后续能力。具体文件读取不再抽取为通用 `io` 层，由 `read` 工具拥有读取流程，以保持读取权限、格式化和输出预算在同一工具边界内。

| 状态 | 子步骤 | 目标文件（职责范围） | 工作内容（功能目标） | 完成标准 |
|---|---|---|---|---|
| ✅ | 8.2.1 文件环境与文件目标 | `src/tools/builtins/file/path.ts`、`tests/tools/file/path.spec.ts` | 让模型提交的相对路径以当前 Session `cwd` 为基准、绝对路径按文件环境语义稳定定位；共享同一 `cwd` 的 Session 对同一物理文件得到同一文件目标；不同 `cwd` 的相对路径保持各自解析结果 | 宿主可在 Session 创建时固定 `cwd`；不自动拼接 `sessionId`；`.`、`..`、符号链接和缺失目标的路径语义可验证；同一物理文件的目标身份一致；沙箱授权不被本子步骤伪装为已实现 |
| ✅ | 8.2.2 Read Tool | `src/tools/builtins/file/read.ts`、`src/tools/builtins/file/read/**`、`tests/tools/file/read.spec.ts` | 让 Agent 能读取已知文件环境路径下的文本：小文件直接读取，大文件流式读取；获得带行号的连续结果、继续读取信息和可保存的结构化结果；超限、非文本、缺失和取消都返回明确结果 | `read` 自身完成从路径目标到文件内容和模型结果的完整读取流程；只返回完整行和可继续读取的元数据；读取输出有界；取消不留下未释放资源或悬挂状态；不提供目录发现或 Shell 扫描 |
| ✅ | 8.2.3 Shell Tool | `src/tools/builtins/shell/**`、`tests/tools/shell/**` | 让 Agent 能在当前 Session `cwd` 中执行命令，使用 `rg`、`ls`、`find` 或 PowerShell 命令发现和搜索文件，并得到可控的标准输出、错误输出和退出结果 | 命令在固定文件环境中运行；stdout/stderr 有界；超时和取消能结束本次执行并返回稳定结果；命令失败与工具拒绝可区分；不额外提供独立 `find` 工具；沙箱和跨文件环境授权仍明确标记为未实现 |
| ✅ | 8.2.6 工具结果出口收口 | `src/tools/types.ts`、`src/tools/service.ts` 与各工具实现 | 让所有工具的结果只有一种写法：模型始终拿到干净的纯文本段，工具私有的结构化数据只在独立的可选出口上传递 | 现有工具的模型可见文本与改动前逐字一致；全部工具对齐到同一出口写法；类型检查与完整回归通过；前端投递不在本子步骤 |
| ✅ | 8.2.4 Edit Tool | `src/tools/builtins/file/edit.ts`、`tests/tools/file/edit.spec.ts` | 让 Agent 能对已知文本文件执行唯一匹配的精确替换，并在成功时完整发布新内容 | `oldText` 不存在、多次出现或重叠命中时不修改文件；成功修改不产生半成品；UTF-8、大小、权限和中断错误稳定归类；本子步骤不实现版本观察或跨进程锁 |
| ✅ | 8.2.5 Write Tool | `src/tools/builtins/file/{write,atomic,observation}.ts`、`tests/tools/file/{write,read,protocol}.spec.ts` | 按 DSH 工具面让 Agent 只提交 `path + content`：目标不存在时创建，目标已存在时执行整文件替换；已有文件必须先由同一 Session 成功 `read`，局部修改继续优先使用 `edit` | 模型不选择 create/overwrite；盲覆盖返回稳定 `not-observed` 且不修改原文件；成功 `read` 按分页累计 canonical-path 行覆盖，只有完整读到 EOF 才建立可覆盖观察；Write 与 Edit 共用 sibling staging + fsync + rename 原子发布；overwrite 保留原文件 mode；本步骤明确不比较文件版本，stale/并发竞态留给 8.5 |

#### 8.2.2 Read Tool 实施子步骤

| 状态 | 子步骤 | 目标文件（职责范围） | 工作内容（功能目标） | 完成标准 |
|---|---|---|---|---|
| ✅ | 8.2.2.1 读取目标预检 | `src/tools/builtins/file/read.ts`、`src/tools/builtins/file/read/**`、`tests/tools/file/read.spec.ts` | 让 Agent 对传入路径获得稳定、明确的可读取结论，并能区分缺失目标、目录、不可读取目标和普通文件 | 普通文件进入读取流程；其他目标返回可识别的失败结果，不读目录、不把特殊目标当作普通文本处理 |
| ✅ | 8.2.2.2 文本解码与行源 | `src/tools/builtins/file/read.ts`、`src/tools/builtins/file/read/**`、`tests/tools/file/read.spec.ts` | 让 Agent 能正确读取 UTF-8 文本，并在小文件与大文件上保持一致的行语义；非法文本、二进制特征和取消请求均能结束读取 | UTF-8、BOM、CRLF/LF、空行和末尾换行具有稳定行为；小文件直接读取，大文件不要求把完整内容一次性保存在内存中；非法文本和取消均有明确结果 |
| ✅ | 8.2.2.3 行窗口与结构化结果 | `src/tools/builtins/file/read.ts`、`src/tools/builtins/file/read/**`、`tests/tools/file/read.spec.ts` | 让 Agent 能按起始行和数量读取连续窗口，只得到完整行，并知道文件总行数及下一次读取位置 | `startLine/maxLines` 的边界行为稳定；结果包含可序列化的路径、行号、文本、总行数和继续读取信息；输出始终受界限约束 |
| ✅ | 8.2.2.4 结果保存与模型投影 | `src/tools/builtins/file/read.ts`、`src/tools/builtins/file/read/**`、`tests/tools/file/read.spec.ts` | 让同一份读取结果既可作为 JSON 保存或回放，也可转换成适合模型继续工作的简洁纯文本 | JSON 结构与模型文本来自同一结果，不通过重新读取或 `JSON.stringify` 充当模型正文；模型能看到行号、内容和继续读取提示，界面或记录侧能保留结构化元数据 |
| ✅ | 8.2.2.5 读取闭环验收 | `src/tools/builtins/file/read.ts`、`src/tools/builtins/file/read/**`、`tests/tools/file/read.spec.ts` | 让 `read` 在成功、失败、超限和取消场景下形成一致的工具行为，并覆盖小文件、大文件和窗口连续读取 | 单元测试证明目标预检、两种读取路线、文本边界、窗口连续性、结果投影和取消语义；完成后可作为 8.2.3 Shell Tool 的稳定前置能力 |

## 8. 跨端接入：F2.2 Backend Kernel Host 与真实模型

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | F2.2 Kernel Host 与真实 Qwen | `src/host/**`、`src/llm/adapters/qwen*.ts`、`scripts/{real,mock-kernel-host}.ts`、`tests/{kernel-host,host-process,qwen-chat-adapter}.spec.ts` | 由独立进程装配 `createApp()`、Qwen Adapter 和 Stream RPC Server；stdio 只传 NDJSON，日志走 stderr；Runtime 提供正文观察出口；Mock Host 可编排完成、失败、截断、挂起和崩溃 | `agent.turn` 按 started/delta/唯一终态输出；reasoning 不混入正文；取消贯穿；工具默认禁用；断流、HTTP、Host 生命周期和共享 RPC 契约测试通过 |
| ✅ | F3.2.1.1 助手流语义与链路收敛 | `src/{llm,agent,host}/**`、`rpc/content/**`、相关测试 | 让同一模型输出在实时展示与内核处理之间只分叉一次：前端获得可自行重建内容的有序片段，内核获得可持久化和执行工具的完整消息；各层术语与身份粒度保持唯一 | 实时路径不经过后端内容聚合；每个 Step 和内容单元生命周期闭合；多 Step 与交错内容不串混；旧 `agent.turn` 行为不变；完整类型检查和测试通过 |
| ✅ | F3.2.1.2 工具能力归属收敛 | `src/{agent,host,node}/**`、`scripts/**`、相关测试 | 让工具选择只来自受信任的内核 Agent 配置；普通 RPC 回合没有内核授权时不能向模型暴露或执行任何工具，领域 Agent 仍使用自己的精确能力集合 | v1/v2 RPC 输入和 Handler 均不选择工具；内核缺省关闭工具并同时约束 Schema 与执行；伪造调用被拒绝；现有 NodeAgent 能力不变；类型检查与相关回归通过 |
| ✅ | F3.2.1.3 统一回合观察事件 | 内核事件输出、共享契约、Host 与相关测试 | 同一次回合向内核观察者和 RPC 客户端提供一致的正文、思考与生命周期；调用方可直接重建内容，无需再次解释业务事件 | 内核输出可直接通过公共校验；Host 原样传递；失败与取消闭合生命周期；旧接口仍能显示正文；类型检查与跨端回归通过 |
| ✅ | F3.2.2 工具执行事件接通 | 内核模型输出、工具执行边界与相关测试 | 让调用方能够按同一身份关联模型生成的工具参数、实际执行和最终结果，并区分执行前拒绝、执行失败与取消 | 分片名称和参数组成完整调用；只有进入工具函数才发布执行开始；每个公开调用在 Step 结束前得到唯一有界结果；Host 无工具业务转换；类型检查与回归通过 |
| ✅ | F3.2.3 会话命令流与 `/hello` | `src/{command,agent,host}/**`、`shared/content.ts`、`rpc/**`、相关测试 | 让前端能够提交会话命令并接收可关联的开始、完成、失败或取消结果；`/hello` 可在当前或最近回合下即时反馈，空会话也有稳定归属 | 命令事件与回合事件共享统一解析和 RPC 帧格式；旁路命令不触发模型；排队命令按会话顺序执行并支持取消；活动回合、最近回合和空会话锚点可验证；类型检查与跨端回归通过 |
| ✅ | F3.2.4 Mock Host 与端到端回归 | `scripts/host/mock.ts`、`tests/host/process.spec.ts`、相关 RPC 测试 | 让已完成的回合事件与会话命令能力能够在独立 Mock Host 进程中被客户端完整消费，并复现完成、失败、取消、EOF 与进程退出等生命周期 | Mock Host 注册 `agent.turn.v2` 与 `session.command.v1`；stdio 只传合法 RPC 帧且日志留在 stderr；客户端可关联回合/命令身份和终态；取消后不再接收尾事件；旧 `agent.turn` 和既有 Host 生命周期测试保持通过 |

阶段 8.1 原先定义了包含 `find` 的文件工具协议；本步骤已按 Pi 路线移除文件工具层的独立 `find` 请求、结果、Schema 和扫描错误文案，保留 `read`、`write`、`edit` 的输入与结果契约。8.2.1 已建立共享执行工作区的路径目标定位：Session 创建时固化 `cwd`，相对路径以其为基准，绝对路径不被人为改写，Session 不自动隔离为物理子目录；8.2.5 已增加 Session 级“完整读过才能整文件覆盖”的观察门禁和原子发布；分页 Read 会累计覆盖范围，只有完整覆盖文件才授权 Write，但观察记录仍不保存文件版本。8.2.2 Read、8.2.3 Shell、8.2.4 Edit、8.2.5 Write 与 8.2.6 工具结果出口均已完成；下一步进入 8.3。文件版本、stale 检测、并发创建保护和目标级串行化统一留到 8.5 收口。

## 源码目录整理

### F3.7 思考内容修正

| 状态 | 步骤 | 目标文件（职责范围） | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | F3.7 思考内容修正 | Host 配置、Qwen 适配器及相关测试 | 默认请求模型思考内容，并将真实服务返回的思考文本提供给既有展示链路；允许显式关闭思考 | 真实模型思考和正文均可被适配器接收；既有 v2 事件测试通过；前端人工展示复验独立记录 |

交接见 [F3.7 开发记录](42-devlog-f3-7-reasoning.md)。后端阶段 8 当前下一步不变。

已按 [目录整理方案](24-structure.md) 完成单词文件命名、子模块目录归位与测试／脚本引用迁移，详见 [实施记录](25-structure.md)。RPC 传输实现位于 `rpc/stream/`，桌面共享契约位于 `frontend/shared/`；本次结构重构未推进后续功能步骤。
