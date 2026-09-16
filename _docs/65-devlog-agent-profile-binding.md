# F9.4 Agent Profile 与 Binding

## 做了什么

完成 Main Agent / Node Agent 的角色与可信身份边界。新增 Main Agent Profile 与 Main Session 入口；Node Profile 在真实执行路径中获得所属 Project Goal；新增基于 ProjectStore / NodeStore 所有权动态解析的 Agent Binding，并在 Main / Node Session 执行前校验。两种角色继续复用唯一 `AgentRuntime`，未新增角色专属 Runtime。

## 核心链路

```text
ProjectStore.mainSessionId ----+
                               +--> trusted Session Binding --> Main / Node scope
NodeStore.node.sessionId ------+              |
                                              v
                                     Profile + tool list
                                              |
                                              v
                                         AgentRuntime
                                              |
                                              v
                                         ToolService
                                              |
                                   trusted context.sessionId
```

## 关键决策

- Binding 不新增 Store，也不保存第三份身份状态；`resolveAgentBinding()` 每次从 ProjectStore 的 `mainSessionId` 与 NodeStore 的 `sessionId` 归属派生 Main / Node 身份。若同一 Session 同时出现两种归属，直接以 `binding-ambiguous` 拒绝。
- Profile 只控制模型可见角色、上下文和工具名单，不承担最终授权。Main / Node 的真实权限以后由工具或领域服务根据 Runtime 注入的 Session 身份调用 `requireMainBinding()` / `requireNodeProjectBinding()` 再校验。
- Main Session 始终从 Project 自己的 `mainSessionId` 启动，不接受调用方自报 Session；归档 Project 在进入模型前拒绝执行。
- Node Session 在 `working` 状态产生前校验 `Session -> Project -> Node` 三者归属，随后才构造包含 Project Goal 与当前 Node Objective 的 Profile。Node 新 Session 生成时同时避开现有 Main Session 和 Node Session 身份。
- Main Profile 不读取 Node 私有 Session 或 Node 内容；Node Profile 不包含 Session / Node ID 等可信身份字段。跨节点协调仍只作为约束说明，实际 Mailbox 留到 F9.6。

## DeepSeek Harness 对照

参考 `deepseek-harness/packages/core/agent-loop/src/index.ts`：Harness 将 configured agent 的 exact Session identity 由 launcher 在 Agent 创建前确定，并对重复 identity 做确定性校验；Agent loop 本身复用统一执行机制。F9.4 采用相同的“身份由模型循环之外的可信边界拥有”原则，但没有引入 Harness 的 AgentRegistry / AgentFactory 生命周期体系，因为 Navo 已由 ProjectStore 与 NodeStore 分别拥有 Main / Node Session 归属，继续复用这些事实源更简单。

## 测试覆盖

新增测试覆盖：Main / Node Binding 的派生与角色错误；伪造 ProjectId / NodeId 的拒绝；Node 即使被错误暴露一个 Main-only 测试工具，也会因为 ToolExecutionContext 中的真实 Session 身份被 Binding 拒绝；同一工具对正确 Main Session 放行；Main Session 多轮上下文、Profile 转义与归档 Project 拒绝；应用层验证 Main / Node 两类 Profile 都经过同一个 AgentRuntime。

当前云端执行环境无法拉取仓库依赖并运行 `pnpm typecheck` / `pnpm test`，因此本记录只声明测试代码已补齐与源码级检查完成，不把未执行的测试写成通过。合并前仍需在正常开发环境执行完整类型检查与测试套件。

## 下一步

F9.4 的职责在此收口。下一步进入 F9.5：让 Main Agent 基于 Goal 与当前 Roadmap 提出创建/修改方案，并让确定性 Roadmap 边界验证后再提交；不在 F9.4 提前加入 Roadmap Mutation 工具、Mailbox、ProjectRuntime 或 RPC / 前端契约。
