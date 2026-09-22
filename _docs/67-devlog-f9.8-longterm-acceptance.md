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
- [PR #30](https://github.com/likeWind221/Navo/pull/30) 的 [GitHub CI](https://github.com/likeWind221/Navo/actions/runs/35684876621) 通过（46 秒），最初据离线验收标为完成，尚未合并。后续真实模型测试发现下述未收尾问题，状态改回进行中。桌面 UI、数据库或进程重启恢复未验证；现有取消/释放矩阵继续由 F9.7 测试覆盖。

## 真实模型补充验收（2026-09-22）

- 用户要求真实模型测试，新增 `scripts/longterm.ts`，通过 `pnpm exec tsx scripts/longterm.ts` 显式运行，不接入离线 CI。沿用 Host 的 `LLM_*` 配置，实际模型为 `qwen3.8-27b`、thinking 开启、maxTokens 8192；每回合上限 16 步，关闭模型自动重试，输出回合耗时、工具名称、最终回答和实际状态，不输出凭据或推理内容。
- 运行器复用 NavoApp、Qwen adapter 和 ProjectRuntime。只由模型通过工具创建与修改路线、发布与授权资源、报告阻塞；脚本模拟 8 次 Human Turn 与人工完成确认，并检查锁定、资源可见性、会话复用和历史重建。使用预置的合成 A/B 测量及独立复测文件，不声称模型进行了实验或生成证据文件，不涉及前端和 F9.9 契约。
- 首次试跑发现脚本错误地从事件顶层筛选 turnId，导致调用摘要为空，在第 4 回合断言失败；改为从 event.data 读取后做了脚本独立类型检查，再从新项目重跑。此问题属于新验收脚本，未修改生产实现。
- 模型回复存在状态描述滞后：Main 授权资源后仍声称 synthesis locked，实际 Store 已为 idle；以真实状态和 Gate 断言验收，不把模型文本当状态事实。validation 还自主调用 update_resource 补充元数据，真实运行不限制为 Mock 的固定工具次数。
- 修正脚本后的第一次完整尝试：8 次 Human Turn、29 个模型 Step，约 357.5 秒。前 7 回合的规划、资源 ACL、Mailbox、重规划、重新锁定、版本变更均通过，没有工具错误；第 8 回合模型再次读取旧证据并报告看不到新验证资源，未产出要求的 125 ms / 93.5% 结论，验收失败。权限查询确认新资源对 synthesis 可见，但这一轮未记录请求资源快照，不能单凭模型自述判定上下文丢失或模型漏读。
- 为定位该问题，增加每次 llm-requested 系统消息包含的资源 ID 摘要，保持提示词与模型配置不变重新运行。第二次尝试在第 6 回合出现 `Resource source file is unavailable` 工具错误；模型后续恢复，另行注册并读取 evidence.txt，最终报告支持 A。严格验收在该回合结束后失败，没有到第 8 回合，因此原问题根因仍待定位，不能声称诊断已证明上下文正确送达。
- 两次有效尝试都未通过完整真实验收，未实施生产修复、未合并。真实运行还显示节点能将共享 Workspace 中的 evidence.txt 重新注册为自身资源；Registry ACL 不等于节点间文件系统隔离，本测试不作此保证。
- 本次新增脚本独立 TypeScript 检查通过；`pnpm typecheck` 和完整 `pnpm test`（78 文件、457 项）通过。离线绿灯不能覆盖上述真实模型失败，脚本保持非零退出以保留失败信号。

## 下一步

- F9.8 恢复为进行中：先定位续接回合资源发现问题，并明确可恢复工具错误的验收标准，再验证真实模型闭环。PR #30 保留待收尾；本次不请求合并。用户授权范围为真实模型测试，本轮交付新增脚本导读和真实失败结果。
- F9.9 仍为待确认的公共接口交接：先明确 Host/RPC/前端契约，再开始实现。本次未修改共享通信契约和前端文件，F5.2 的公共项目接口依赖尚未交付。
