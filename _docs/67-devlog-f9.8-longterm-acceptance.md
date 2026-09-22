# 67：F9.8 长程 Core 集成验收

## 做了什么

- 用户直接要求完成 F9.8，从最新 master `0e76d4f` 创建 `phase9-f9.8-longterm-acceptance`。只新增验收测试和记录，没有修改生产代码。
- `tests/integration/longterm.spec.ts` 组织 8 次人工回合、29 次模型请求，验证每个阶段的项目事实、人工 Gate、会话隔离和最终历史重放。
- `tests/integration/longterm/script.ts` 提供脚本化模型响应。持久 Node ID 从真实 write/modify 工具结果提取，Resource ID 从 register 结果提取；没有预设 UUID，也不从 Store 向模型注入隐藏的规划结果。
- `tests/integration/longterm/helpers.ts` 装配真实 NavoApp 和临时 Workspace，提供固定输入文件及人工确认，测试结束释放应用和清理本次临时目录。
- 同步后端计划和索引，本任务为共享文档的唯一写入者。

```text
+---------------- F9.8 NEW ACCEPTANCE ----------------+
| Goal -> Human starts Main -> Roadmap                |
|   -> Human starts A -> Resource -> Main handoff     |
|   -> Human starts B -> Blocker -> Main replans      |
|   -> Human starts C -> Resource -> Human confirms   |
|   -> Human continues B -> Human confirms completion |
+----------------------------------------------------+
```

## 关键决策

| 人工回合 | 行为与关键断言 |
|---|---|
| Main 规划 | 读取空路线、write_roadmap 创建 A→B；版本为 1，A idle、B locked，尚无 Node Session |
| A 发布 | register_resource 发布现有证据文件并 send_to_main；资源 private，回合结束仍为 idle，人工确认才解锁 B |
| Main 交接 | read_mailbox 获取报告，set_resource_access 仅授权 B；B 不自动运行 |
| B 报告阻塞 | fetch_resource 读取正文，越权 modify_roadmap 被拒绝；send_to_main 报告缺少独立验证，路线版本仍为 1 |
| Main 重规划 | 读取阻塞和路线，add_node 新增 C，旧版本 connect 被拒绝，重读版本 2 后成功连接 C→B；版本为 3，B 回到 locked 并保留 Session |
| C 补充证据 | 故意携带 A 的 Resource ID 验证 ACL 拒绝未授权读取；发布独立验证资源并报告 Main，C 保持 idle |
| Main 再交接 | 把 C 资源授权给 B；资源到位时 B 仍 locked，只有人工确认 C 后才解锁 |
| B 继续 | 同一 Session 保留之前阻塞上下文，新回合发现新资源 metadata，按 ID 读取正文后给出结果，人工确认完成 |

- 使用一个 MockLLMAdapter 队列驱动完整链路，领域服务、工具执行、文件发布/读取、状态变化均为真实实现。Main 规划与重规划通过模型工具调用进行，测试不直接写 Roadmap 或创建工作节点。
- 在每个人工边界让事件循环推进一次，断言模型请求数不变，避免只用同步状态证明“不自动运行”。检查 B 在 locked 时连已有会话也无法继续。
- 验收精确检查三个预期工具失败，其他错误均不允许；检查 4 个独立 Session、每个 Turn/Step 开闭数量、私有会话标记不跨 Session、两份资源的 owner/access/revision、Mailbox 路由，以及 Node/Roadmap 历史重放与最终快照一致。
- 对照 `deepseek-harness/packages/core/agent-loop/src/agent.ts` 的 `turn()` 与 step/turn finally 日志边界，采用事件闭合验收；不移植 inbox 自动继续。Navo 的每个新回合仍由 Human 调用 ProjectRuntime。

## 坑与发现

- 现有生产实现通过完整场景，无需功能修复。业务阻塞用 Mailbox 文本事实表达，Node 仍遵循 locked/idle/working/completing/skipped 五态，不新增 blocked 状态；工具拒绝后允许同一人工授权回合继续报告和协调。
- 资源正文来自测试预置的两份 Workspace 文件，验证发布、权限、交接和读取，不声称模型生成了这些文件。恶意 C 的已知 Resource ID 是权限攻击输入，不代表它正常拥有跨节点资源发现能力。
- 最终三个工作节点均为 completing，但 Project 仍 active；不虚构自动完成或自动归档 Project 的能力。
- 本机 `pnpm typecheck` 通过；新场景独立运行通过；完整 `pnpm test` 为 78 个文件、457 项通过。代码检查不依赖真实网络、模型凭据或桌面环境。
- GitHub CI 待 PR 执行，当前 F9.8 标为进行中。未验证真实模型自主规划质量、桌面 UI、数据库或进程重启恢复；现有取消/释放矩阵继续由 F9.7 测试覆盖。

## 下一步

- 创建 F9.8 PR，CI 通过后更新计划完成状态并报告合并确认；本轮最终回复提供场景导读、文件职责与实际边界。
- F9.9 仍为待确认的公共接口交接：先明确 Host/RPC/前端契约，再开始实现。本次未修改共享通信契约和前端文件，F5.2 的公共项目接口依赖尚未交付。
