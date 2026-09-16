# F9.1–F9.2：Project 与通用 Node 领域

## 做了什么

- F9.1 建立 ProjectId、固定 Goal、Main Session 归属、active/archived 生命周期、事件导出与恢复；通过 `src/app.ts` 装配 ProjectStore。
- F9.2 将 `src/node/` 泛化为有 Project 归属、objective 和 acceptanceCriteria 的工作单元，移除教材/练习模型、NodeContentTools 和 startLearning，执行入口改为 start。
- 根据用户要求增加 locked、idle、working、completing。completing 为用户指定的人工确认终态，修正原拼写 compeleting；它不表示“正在完成”。
- 更新 Node、应用研究闭环、搜索与 Host 工具注册测试；旧学习内容测试随被删除的能力移除，保留并加强会话复用、上下文隔离、FIFO、并行、取消和卸载验证。

## 关键决策

```text
ProjectStore -> NodeStore -> Node events -> projectNode -> snapshot
                    ^
NodeSession.start -> queue -> recheck -> beginWork
                               |           |
                               |           v
                               |        Profile -> existing AgentRuntime
                               |                       |
                               +------ finally <-------+
                                          |
                                       endWork

locked <-> idle -> working -> idle
             |
             +-- confirmCompletion (trusted human entry) --> completing
```

- 新 Node 默认 locked；unlock/lock 只在 locked/idle 间转换并记录原因。锁定当前是显式领域状态，F9.3 再定义与依赖资格的关系。
- NodeStore 拥有节点历史；create 校验活跃 Project，bindSession 拒绝其他 Node 或 Project Main 的会话。get/getBySession/getByProject/getEvents 提供查询。append 生成版本、时间、事件 ID，调用 projectNode 校验候选历史后才提交，观察者失败不撤销事实。
- 版本 2 的 NodeEvent 用创建、会话绑定、锁定/解锁、工作开始/结束、人工确认表达事实。projectNode 校验字段、项目身份文本、事件顺序、连续 revision、唯一 ID 和合法状态转换；immutable 分离调用方对象并冻结事实。模型/协议/错误是独立公共边界，短文件保留。
- NodeSessionService 的 start 创建或复用会话；dispatch 保留同 Session FIFO；runQueued 在实际执行前重查 Project、状态与会话归属，再设置 working、构建最新 Profile 并调用现有 Runtime。finally 恢复 idle，成功、失败、取消及意外拒绝均不自动完成节点。项目归档后允许 endWork 清理，但禁止后续执行。
- confirmCompletion 是只供可信后端人工入口调用的 API，不注册为模型工具，不接受模型传入的“human”角色作为授权。它只接受 idle 节点，校验 reviewedRevision 与当前版本相同，记录 confirmedBy、reason 和审核版本；终态不再接收执行。当前尚无 UI/RPC 人工身份认证，调用方必须先确认真实人工操作；confirmedBy 是审计字段，不是认证凭据。
- Profile 仅包含本节点目标与状态，不带其他节点上下文；保留 Search/Fetch 和按配置加入的 read，移除学习身份与教材工具。未扩展 Node 的 Shell/write/edit 权限；完整 Profile/Binding 在 F9.4 实施，文件 cwd 也不是沙箱。
- F9.1 的 ProjectStore 使用版本 1 历史，先重建再恢复，不覆盖已有项目或复用已归属 Main Session；归档项目仍保留主会话。Project 与 Node 的历史分开，Session 仍保存对话。跨 Store 的统一绑定恢复授权留给 F9.4。
- 参考 `deepseek-harness/packages/core/session/src/index.ts` 的事实/投影分离，以及 `deepseek-harness/packages/core/agent-loop/src/index.ts` 的生命周期所有权和取消机制；不照搬完整发布、持久化、scope 或多 Agent 工厂。Node 状态和人工确认是 Navo 本步自定义语义。

## 坑与发现

- 旧 Node 事件格式、学习内容 API 不做兼容转换；版本 2 明确拒绝旧历史。当前只有内存事实存储，没有自动跨进程恢复或 working 崩溃修复。
- Agent 的 completed Turn 只表示回合结束，正常输出“完成了”仍返回 idle；伪造 confirm_completion 工具被白名单拒绝，只有可信人工调用才能写入完成事件。
- 补充验证排队后锁定、人工完成或项目归档均拒绝启动；Runtime 意外拒绝也退出 working。人工确认早于排队请求启动时，该请求被拒绝，不会把终态覆盖为 working。
- 验证：首次相关检查 9 个文件 51 项通过；增加 4 项队列/异常边界测试后，Node Session 全部 13 项通过（相关集合合计 55 项）；类型检查通过。旧 startLearning、NodeContentTools、CapabilityTarget 与 node/tools.js 的运行引用已清零。未做真实模型或前端交互验收。

## 下一步

- F9.1、F9.2 交付；下一步 F9.3 Persistent Roadmap Board，另行介绍与确认。
- 未实现 Roadmap、Mailbox、Main 规划、完整执行授权、数据库、人工确认 RPC/UI 或 Verification；人工确认状态不等同于机器验证通过。
- 本次由后端串行登记本合并记录并补齐 F9.1 的文档交付，不覆盖前端已有记录。完成回复提供代码模块与状态机导读。
