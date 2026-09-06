# 阶段 6：Node 学习内容闭环

> 本文整合原 Step 6.1–6.15 的过程文档，描述阶段 6 在提交 `7cbe687` 收口时的产品契约、最终架构、关键取舍和验收证据。阶段 7 对 Search 边界的后续收缩不改写这里的历史结论。

## 1. 目标与范围

阶段 6 把通用 Agent Runtime 接入第一个真实应用切片：用户围绕一个能力 Node，在持续的 NodeSession 中完成搜索、教材生成、练习题生成、答疑和内容修改。

本阶段交付：

- `NodeId`、`ExerciseId` 及 Node、教材、题集、来源引用等领域协议；
- 可严格重放的 NodeEvent、内存 NodeStore 和 Node–Session 一对一绑定；
- 教材与题集完整替换命令，以及隐藏参考答案的学习者投影；
- `web_search`、Mock/Exa Adapter、安全错误、超时取消和有界结果；
- 每 Turn 刷新的 NodeAgent Profile、工具白名单和 Session 来源授权；
- NodeSession 的 start/send/stop、同 Node FIFO 和跨 Node 并行；
- 分层应用组合及从公开入口执行的端到端验收。

明确不在阶段 6：网页正文抓取、持久化、无状态 Grader、Attempt/Evidence/Verification、Main Agent 与 DAG、正式跨进程 Host。

## 2. 最终产品契约

### Node 与 Session

- Node 是可描述且最终可验证的能力单元，不是章节、Turn 或 Session。
- 每个 Node 最多绑定一个持续 NodeSession；一个 Session 也只能属于一个 Node。
- NodeEvent 保存领域事实，SessionEvent 保存模型交互事实，两类日志不互相复制。
- 不同 Node 的会话、Profile、内容读取和写入必须隔离。

### 教材与练习题

- 教材和题集是同一 Node 下的两个可编辑内容面板，不是两条会话。
- 两类内容均采用完整替换并维护独立 revision；NodeEvent revision 维护节点事实流的全局顺序。
- 参考答案属于私有判题数据；学习者投影必须剔除该字段。
- assistant 自然语言不能改变内容；只有结构化领域工具成功后才提交 NodeEvent。

### Agent 权限

- NodeAgent 只服务当前 Node，可以搜索、解释、答疑并更新教材或题集。
- 模型不提交 NodeId；内容工具根据 Runtime 注入的 SessionId 反查唯一 Node。
- Profile 给出 per-turn 工具白名单，ToolService 执行前再次校验。
- NodeAgent 不修改 Road Map/DAG、不访问其他 NodeSession，也不能宣布 mastery。
- 未来 Grader 是不加载 NodeSession 历史的无状态调用；Verification 才能基于 Evidence 判断掌握状态。

## 3. 最终模块关系

```text
SkillWorldApp
├─ SessionStore       对话与运行事件、模型消息投影
├─ LLMService         Provider 路由与流式协议
├─ ToolsPlugin
│  ├─ ToolService     Schema、注册、执行与白名单
│  └─ Search          阶段 6 为 SearchService + SearchTool + Adapter
├─ AgentRuntime       Turn/Step 生命周期和模型→工具→模型循环
└─ NodePlugin
   ├─ NodeStore       NodeEvent 提交与快照重建
   ├─ NodeContentTools
   └─ NodeSessionService
```

阶段 7.0 已依据“单个 SearchTool 是唯一消费者”的事实删除 `ctx.search` 与动态 Adapter 注册层，改为 SearchTool 构造时注入单 Adapter。该调整属于后续边界收缩，不影响阶段 6 的 Node 契约。

## 4. 核心执行路径

```text
startLearning(nodeId, text)
  → 校验 Node；首次调用时绑定唯一 Session
  → 进入该 Session 的临时 FIFO
  → 执行时读取最新 NodeSnapshot
  → 生成 system prompt + 工具白名单
  → AgentRuntime 写入 SessionLog 并调用模型
  → web_search 返回有界、不可信标记的来源数据
  → 内容工具用 SessionId 反查 Node 并提交 NodeEvent
  → 下一 Step/Turn 从日志和最新快照继续
```

`stop(nodeId)` 只取消当前活动 Turn，不删除排队消息；服务卸载会取消活动任务，并以稳定错误拒绝尚未开始的任务。不同 Node 使用不同 FIFO，因此可以并行运行。

## 5. 状态与一致性

NodeEvent 在提交时获得全局唯一事件 ID、连续 revision 和时间戳。Store 先用完整候选事件流执行严格投影，成功后才提交并异步通知观察者。

投影器拒绝非连续 revision、创建前事件、重复创建或绑定、绑定前内容修改、内容 revision 跳跃及重复 ExerciseId。提交事件和返回快照均经过复制与递归冻结；观察者失败只记录日志，不回滚已提交事实。

## 6. Search 边界

阶段 6 的 Search 分为公共协议、执行边界、Adapter、模型输出四层：

- query 必须非空，`maxResults` 为 1–20，省略时规范为 8；
- 执行层统一超时、取消、迟到结果丢弃、结果校验、复制与冻结；
- Exa Adapter 固定 HTTPS 端点、拒绝重定向、限制响应为 5 MiB，并清洗 Provider 错误；
- 输出限制为 30,000 字符，只保留完整来源，并标记外部内容不可信；
- 密钥只由可信 Host 注入，不进入工具参数、Session、日志或模型消息。

Mock Adapter 支持确定性结果、失败和挂起。真实 Exa 冒烟测试采用显式 `--live`，只从已有本机配置在内存中读取密钥。

## 7. 关键取舍

| 早期方案 | 最终决定 | 原因 |
|---|---|---|
| LearnSession + PracticeSession | 每 Node 一个 NodeSession | 教材、练习、答疑和修改需要共享连续上下文 |
| 提前加入 learn/practice/mastery 状态机 | 只保留 Node、内容和会话 | 避免在 Grader、Evidence、Verification 尚不存在时固化伪状态 |
| Tutor 与 Assessor 两个长期 Agent | 一个持续 NodeAgent，未来另设无状态 Grader | 减少重复上下文与权限同步 |
| 模型传入 NodeId | Runtime 注入 SessionId，Store 反查 Node | 消除模型选择写入目标造成的越权路径 |
| assistant 文本解析为内容 | 结构化完整替换工具 | 可校验、可重建，失败不产生半提交 |
| `src/learning` 与 `src/node` 并存 | 统一为 `src/node` | 避免目录、服务和领域语言漂移 |

## 8. 步骤追踪

| 步骤 | 主题 | 最终产物 |
|---|---|---|
| 6.1–6.3.2 | 产品契约与范围收敛 | 单 NodeSession、内容面板、Agent/Verification 边界 |
| 6.4–6.5 | Node Store | Store、Projector、Node–Session 绑定及严格重放测试 |
| 6.6–6.8 | 内容协议与工具 | 内容事件、工具白名单、Session 授权与行为测试 |
| 6.9.1–6.10.3 | Search | 协议、执行、Mock/Exa、格式化、Tool 与完整测试 |
| 6.9.8 | 领域归并 | `learning` 收拢为 `node` |
| 6.11–6.13 | NodeAgent 与 NodeSession | 动态 Profile、FIFO、取消、隔离和生命周期测试 |
| 6.14 | 应用组合 | Session、LLM、Tools、Runtime、Node 同层根模块 |
| 6.15 | 端到端收口 | `tests/node-learning-integration.spec.ts` |

## 9. 验收与后续

阶段 6 收口时根项目 typecheck 通过，20 个测试文件、151 项测试通过；端到端场景执行 3 个完整 Turn、12 次模型调用并验证两个 Node 隔离。NodeEvent 可重建内容，SessionLog 可重建对话。正式 review 后又补充了 RPC 取消顺序、服务端任务收敛和严格 UTF-8 解码的可靠性修复。

后续依次补齐：阶段 7 Search→Fetch 调研链路、阶段 8 无状态批改、阶段 9 Evidence/Verification、阶段 10 Main Agent 与 DAG，以及持久化和前端 Kernel Host。
