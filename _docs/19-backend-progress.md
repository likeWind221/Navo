# 后端开发进度总览

**基线提交：** `294d624`  
**更新原则：** 本文记录当前可运行能力和下一步，不替代逐步开发日志；历史决策见阶段汇总文档。

## 1. 当前结论

> 路线已更新：阶段 8 改为通用文件工具与网页结果留存；原无状态练习批改、Attempt/Evidence/Verification、Main Agent 与 DAG 顺延为阶段 9–11。本文其余旧阶段编号以 `backend-plan.md` 为准。

后端已完成从通用 Agent Runtime 到“搜索 → Fetch → Node 内容提交”的纵向闭环，并完成独立 Kernel Host、Qwen SSE 和 Stream RPC 接入。应用仍保持 Provider-neutral：业务层依赖统一 LLM/Tool 协议，真实模型和网络凭据由 Host 注入。

当前后端已完成阶段 8.1 文件工具协议与错误，下一步为 8.2 受控 Session 工作区辅助层。Main Agent、学习地图和 Verification 仍未下沉到 AgentRuntime。

## 2. 已完成阶段

| 阶段 | 状态 | 交付物 | 主要入口 |
|---|---|---|---|
| 0 | ✅ | TypeScript、Node、pnpm、Cordis 工程骨架 | `package.json`、`tsconfig.json` |
| 1 | ✅ | 品牌 ID、LLM 消息与工具协议 | `src/brand`、`src/llm/types.ts` |
| 2 | ✅ | SessionEvent、追加日志、消息投影与 Surface | `src/session` |
| 3 | ✅ | 流式 LLM、ToolService、Schema 和测试工具 | `src/llm`、`src/tools` |
| 4 | ✅ | AgentRuntime、Turn/Step 生命周期、重试和取消 | `src/agent` |
| 5 | ✅ | 应用组合与模型→工具→模型闭环 | `src/app.ts`、`tests/integration/app.spec.ts` |
| 6 | ✅ | NodeSession、Node 内容、Search、教材/题集工具 | `src/node`、`src/tools/builtins/search` |
| 7 | ✅ | `web_fetch` 安全执行、网络策略、HTML→Markdown | `src/tools/builtins/fetch` |
| F2.2 | ✅ | Kernel Host、Qwen Chat/SSE、`agent.turn` Handler | `src/host`、`src/llm/adapters/qwen*` |

阶段 6 的契约和取舍已整合到 [阶段 6：Node 学习内容闭环](10-devlog-phase-6-node-learning.md)；阶段 7 的过程和验收见 [阶段 7 Fetch 收口](18-devlog-phase-7-fetch.md)。

## 3. 当前后端架构

```text
Kernel Host
├─ StreamRpcServer / agent.turn
├─ SkillWorldApp
│  ├─ SessionStore       对话和运行事件
│  ├─ LLMService         Provider 路由
│  ├─ ToolsPlugin        SearchTool、FetchTool、ToolService
│  ├─ AgentRuntime       Turn/Step 编排
│  └─ NodePlugin         NodeStore、Node 工具、NodeSession
└─ stdout: NDJSON RPC / stderr: 脱敏日志
```

领域事实与执行事实仍然分开：NodeEvent 记录教材/题集等 Node 内容，SessionEvent 记录模型交互，RPC 只传输 Agent Turn 事件。

## 4. 已验证能力

- Node 与 NodeSession 一对一绑定；不同 Node 的 Profile、对话和内容相互隔离。
- 内容只能通过结构化工具提交，参考答案不会进入学习者投影。
- Search/Fetch 统一执行输入输出校验、超时、取消、字节/字符预算和安全错误。
- Fetch 只返回有界完整正文；超限、非法编码和恶意/不支持内容会失败关闭。
- Qwen reasoning 与正文分离，Host 只向 Renderer 发送稳定的 Agent Turn 事件。
- Tool 白名单、Session 授权和 Host 凭据边界均在运行时重复校验。

## 5. 验收证据

基线提交前后的验证包括：

- 根项目：28 个测试文件、198 项测试通过；
- RPC：2 个测试文件、11 项测试通过；
- 根项目、RPC 和前端 TypeScript 检查通过；
- Electron 生产构建通过；
- Mock Host 覆盖完成、失败、截断、挂起、崩溃和取消；
- 真实 Qwen 链路完成 SSE → RPC → IPC → React 的可选验收。

## 6. 当前未完成与边界

### 下一步：阶段 8

8.1 已完成 read/find/write/edit 的模型 Schema、请求、分页结果、协议上限与稳定错误；下一步为 8.2 Session 受控工作区辅助层，工具尚未注册，IO 与 Fetch spill 尚未实现。NodeAgent 默认只获得 read/find，教材与题集仍通过领域工具修改。

### 后续阶段

- 阶段 9：无状态练习批改 MVP。

- 阶段 10：PracticeAttempt、Evidence、Verification；
- 阶段 11：Main Agent、学习地图/软关系、规划执行和再规划；
- 持久化：事件 schema 版本、迁移、正文外置和内容寻址；
- RPC 增强：重连、多会话、背压和更多业务流。

## 7. 进度维护规则

完成一个后端 Step 时：

1. 更新 `backend-plan.md` 的状态和目标文件；
2. 在对应阶段总览补充交付物、验证和遗留边界；
3. 过程性细节写入单独 devlog，稳定结论才回填本文；
4. 若文件架构变化，同步更新 [模块分文件架构审核](16-module-file-architecture-review.md)。

## 源码目录整理

已按 [目录整理方案](23-structure.md) 完成单词文件命名、子模块目录归位与测试／脚本引用迁移，详见 [实施记录](24-structure.md)。RPC 传输实现位于 `rpc/stream/`，桌面共享契约位于 `frontend/shared/`；本次结构重构未推进后续功能步骤。
