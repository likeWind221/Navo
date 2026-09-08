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
- **阶段 8：通用文件工具与网页结果留存**——在 Tools 根内并列加入 `read`、`find`、`write`、`edit`，用受控 Session 工作区保存超长网页结果；不引入 FileSystem Service、Shell 或远程后端。
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

阶段 0–7 已完成。`web_fetch` 现作为 Tools 根内置的纯文本工具，由内部 FetchCore 组合安全 HTTP、公共网络策略和有界 HTML→Markdown；NodeAgent 通过白名单执行 Search→Fetch→内容提交，Fetch 结果只进入 SessionLog，NodeEvent 只记录最终教材与题集。阶段 7 专项测试 5 个文件、29 项通过，全项目 28 个测试文件、198 项通过；真实 `https://example.com` 冒烟在当前环境因 `blocked-url` 安全关闭，未绕过 DNS/代理返回的非公网地址。跨端 F2.2 已完成 Kernel Host、Qwen SSE Adapter、agent.turn Handler 和可脚本化 Mock Host。当前后端已完成 **8.1 文件工具协议与错误**，下一步为 **8.2 受控 Session 工作区辅助层**；桌面链路可继续进入前端 F2.3。

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

## 7. 阶段 8：通用文件工具与网页结果留存

**阶段目标：** 在 Tools 根内以 Pi 式并列 Tool Plugin 提供 `read`、`find`、`write`、`edit`，让模型在受控 Session 工作区读取、定位和修改文本；`web_fetch` 对已完整抓取但不适合内联的结果写入该工作区，再由 `read/find` 继续读取。

**阶段边界：** `ToolsPlugin` 仍只暴露 `ctx.tools`。文件路径始终相对于受控 Session 工作区，拒绝绝对路径与越界路径；本阶段不新增 `ctx.fs`、`FileCore`、Shell、后台任务、远程/容器后端、真实用户目录访问或通用二进制处理。

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | 8.1 文件工具协议与错误 | `src/tools/builtins/file/{types,errors}.ts` | 定义四个模型工具的输入、稳定错误与结果元数据；`read` 按 1 起始行号分页，`find` 以 `scope` 区分路径匹配和单文件文本定位 | Schema 与模型结果自解释；不接受宿主绝对路径、未定义 scope 或不受限的读取参数 |
| ⬜ | 8.2 受控 Session 工作区辅助 | `src/tools/builtins/file/{path-policy,io}.ts` | 以共享纯函数解析 Session 相对路径、隔离目录、UTF-8 文本读取、目录搜索和临时文件 rename 原子写入 | 工具不直接散落调用 `node:fs`；越界、符号链接逃逸、编码/类型错误和写入中断失败关闭；不建立 Cordis Service |
| ⬜ | 8.3 Read 与 Find Tool | `src/tools/builtins/file/{read,find}.ts` | 注册 `read`、`find`；前者返回带行号窗口和 continuation 元数据，后者支持工作区路径发现或已知文本文件中的匹配行和预览 | 大文件读取不一次进入模型上下文；`find` 不执行 Shell；工具卸载取消可中断的扫描 |
| ⬜ | 8.4 Write 与 Edit Tool | `src/tools/builtins/file/{write,edit}.ts` | 注册 `write`、`edit`；写入创建或完整覆盖文本，编辑要求 `oldText` 唯一命中后替换并原子落盘 | 不存在/多重命中/重叠编辑失败且不修改文件；本阶段不实现版本观察或跨进程锁 |
| ⬜ | 8.5 Tools 根、Node 白名单与 Fetch spill 接入 | `src/tools/plugin.ts`、`src/tools/builtins/fetch/{format,tool}.ts`、`src/node/profile.ts` | Tools 根并列组装全部 File Tool；Fetch 在网络与完整正文硬上限内、但超过内联预算时写入 `web/` 相对文件并返回预览和 `file_path` | NodeAgent 只获得 `read/find`，仍只能通过 Node 领域工具修改教材和题集；Fetch 不调用模型层 `write` 工具 |
| ⬜ | 8.6 文件工具与调研闭环测试 | `tests/{file-tools,fetch-tool,node-research-integration}.spec.ts` | 覆盖路径隔离、分页、路径/内容 Find、原子写入、精确编辑、取消、卸载、spill 和 Search→Fetch→Read/Find 闭环 | 离线可复现；无跨 Session 读取或写入；完整回归、typecheck 与 build 通过 |

## 8. 跨端接入：F2.2 Backend Kernel Host 与真实模型

| 状态 | 步骤 | 目标文件 | 工作内容 | 完成标准 |
|---|---|---|---|---|
| ✅ | F2.2 Kernel Host 与真实 Qwen | `src/host/**`、`src/llm/adapters/qwen*.ts`、`scripts/{real,mock-kernel-host}.ts`、`tests/{kernel-host,host-process,qwen-chat-adapter}.spec.ts` | 由独立进程装配 `createApp()`、Qwen Adapter 和 Stream RPC Server；stdio 只传 NDJSON，日志走 stderr；Runtime 提供正文观察出口；Mock Host 可编排完成、失败、截断、挂起和崩溃 | `agent.turn` 按 started/delta/唯一终态输出；reasoning 不混入正文；取消贯穿；工具默认禁用；断流、HTTP、Host 生命周期和共享 RPC 契约测试通过 |
| ✅ | F3.2.1.1 助手流语义与链路收敛 | `src/{llm,agent,host}/**`、`rpc/content/**`、相关测试 | 让同一模型输出在实时展示与内核处理之间只分叉一次：前端获得可自行重建内容的有序片段，内核获得可持久化和执行工具的完整消息；各层术语与身份粒度保持唯一 | 实时路径不经过后端内容聚合；每个 Step 和内容单元生命周期闭合；多 Step 与交错内容不串混；旧 `agent.turn` 行为不变；完整类型检查和测试通过 |

阶段 8.1 已定义四个文件工具的模型 Schema、输入/分页结果、协议上限与安全错误；尚未执行文件 IO，详细契约见 [8.1 开发记录](22-devlog-step-8-1-file-protocol.md)。

## 源码目录整理

已按 [目录整理方案](24-structure.md) 完成单词文件命名、子模块目录归位与测试／脚本引用迁移，详见 [实施记录](25-structure.md)。RPC 传输实现位于 `rpc/stream/`，桌面共享契约位于 `frontend/shared/`；本次结构重构未推进后续功能步骤。
