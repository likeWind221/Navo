# 156：F13.6 后端完整链路验收

日期：2026-10-26。基线 master `4b6d00b`；分支 `phase13-f13.6-backend-acceptance`。用户已授权验收后端完整链路，前端另行安排。本记录区分离线、真实模型和产品入口，不把后端通过写成完整桌面产品通过。

## 做了什么

- 复用既有完整后端套件，补充 9 项组合 / 验收判据测试，没有修改 `src/**`、RPC、前端或依赖。
- 新增真实验收入口 `pnpm exec tsx scripts/library.ts --preflight` / `--real`。preflight 不配置推理服务，只验证真实资料导入和正文处理；real 显式装配 Embedding、图谱、Main / Node 和 Main Review。
- 继续保留准备记录 [155](155-devlog-f13-6-preparation.md)，执行范围缩为其中 A / B / C / E，排除 D / F。没有实施 F13.5、Working Board、独立引用追踪或第二套 Runtime。

```text
[reuse] User import -> content -> index + graph
                                   |
                                   v
[reuse] Main plan -> Node A search/fetch -> submitted answer
                                              |
                                              v
[new] Human harness saves exact answer as Main-owned Resource
                                              |
                                              v
[reuse] Main Review -> directed grant -> durable pause/reopen
                                              |
                                              v
[reuse] Node B fetch/search -> answer -> final Main Review
                                              |
                                              v
[new] factual assertions + request ledger + evidence files
```

复用项均为现有生产能力；新增项只负责验收、原样保存答案和判定证据，不扩大任何 Agent 权限。

### 文件职责与关键实现

| 文件 | 职责与机制 |
|---|---|
| `scripts/library.ts` | 显式命令入口；导入三份固定短语料、驱动真实 Main 规划 / A / Review / 重启 / B / Review。每个 Turn 立即用既有 captureTurn / writeEvidence 保存实际工具记录；失败即停止、不重新跑任务。`materialize` 将真实 Node submission.summary 原样保存为文件，通过可信 Main 主体发布，并核对保存内容与提交完全相同；记录 writer=acceptance-harness |
| `scripts/library/runtime.ts` | 拥有 SQLite、Workspace、模型适配器、计数器和时限；所有生成请求经过既有 RequestLedger，图谱请求另记索引；Embedding HTTP 请求单独计数；全局取消信号合入各调用。相同配置重开并复用计数器；初始化失败和最终关闭均清理本入口的计时器与应用资源 |
| `scripts/library/checks.ts` | 依据可核对语料检查实际答案字段、真实 fetch 轨迹及来源 ID；不接受仅列文件名 / ID 或自称“已读”。检查索引 / 图谱 active、Main 实际读取成果及 complete、持久状态恢复 |
| `scripts/library/data.ts` | 离线与真实入口共用的小型语料、目标和完成标准；包含 Atlas 82 / 88 冲突、Boreal 78、价格 40 / 35、预算 45、部署成本未知；只用于窄范围正确性验收，不能代表检索质量基准 |
| `tests/integration/library/fixture.ts` | 隔离临时 SQLite、真实 Resource / Content / Index / Graph 服务，使用本地固定向量与图谱响应；按需排队 MockLLM 回答。重开后重新注册适配器，保留请求计数，测试结束清理本测试创建的目录 |
| `tests/integration/library/flow.spec.ts` | 一个完整任务：真实用户导入 -> Main 建路线 -> A 搜索 / 读多资料 -> 提交 -> Main 读冲突并返工 -> A 收反馈补做 -> 原样物化 -> 同库恢复 -> Main 确认并定向共享 -> B 消费成果和原文 -> Main 审查 -> 删除后 list / search / fetch 排除 |
| `tests/integration/library/failure.spec.ts` | 七项任务组合：空结果、三种索引 / 配置失败、仅元数据及不可读附件、私有 / 跨项目 / 伪造身份隔离、ProjectRuntime 正在查询 Embedding 时取消。错误与空结果分别进入 Node 报告和 Main escalate，节点不被误确认 |
| `tests/integration/library/report.spec.ts` | 一项防止验收假阳性的检查：即使 JSON 数值正确且列出了真实来源 ID，仅有 list / 自称已读也会被真实入口的判据拒绝 |

小于 40 行的共用 data 文件保留为离线 / 真实入口共同的语料契约；report.spec 保留独立的“防止验收假阳性”场景。其他新增手写文件均不超过 250 行，没有增加仅转发的模块。

## 关键决策

### Node 成果的真实边界

首次新增主流程测试调用 `write` 被现有 Node Profile 拒绝；随后发布不存在的文件自然失败。证据保存在本机 `flow-diagnostic.log`。这是验收脚本假设与现有只读 Profile 不符，本轮没有据此认定生产缺陷，也没有开放 write / shell。

当前支持以 `submit_completion.summary` 本身交付答案。离线和真实入口都使用这一路径，随后由 Human 验收脚本原样物化为 Main-owned Resource；此做法沿用 F12.7 的可信交接方式。**不能宣称 Node 已获得自行创建文件、写入资料或自主发布新生成文件的能力。** Node 的 register_resource 仍只发布已存在的 Workspace 文件。

模型的完成标准明确允许答案本身作为成果，不要求 Node 谎称已经发布文件。Main 仍根据目标、标准、原文和实际答案审查；只有接受后才共享给 B。返工测试故意提供不完整草稿，真实任务则让 Main 依事实判定，不强迫模型制造返工。

### 真实执行控制

- 暂定 gpt-6-luna 订阅适配器；所有生成调用最多 48 次，含图谱和摘要；Embedding 最多 20 次；总时限 20 分钟。使用已有 Qwen3-Embedding-4B 服务，不启动新服务、不调整远端配置。
- 任务运行时 `maxModelRetries=0`，Embedding `maxAttempts=1`。图谱沿用生产的有限格式修正 / 拆批重试，也计入 48 次上限；不声称图谱内部零重试。
- 每个真实 Node 的提交必须是约定 JSON，数值与冲突 / 缺项须匹配语料；至少真实 fetch 两份资料，A 必须读取全部三份源资料，B 必须读取交接和约束。自报来源不能替代工具记录；Main 必须实际 fetch 物化成果后才可记通过。
- 已提交、全部索引和图谱就绪后重开同库，要求权威状态相同、请求数不增长、无 AutoRun；只在显式 Human 动作后运行 B。既有正式子 Host / SIGKILL / D1–D8 复用完整套件，本新增任务不冒称做过整个任务的进程强杀。
- 正式 Host 当前未传 graph 配置；真实入口直接显式 createApp 配置以验收应用内后端链路，不借此宣布正式 Host 图谱装配、Bridge 或 Renderer 已完成。

## 验证结果与边界

环境：Windows PowerShell；当前命令进程临时使用 System32 在 PATH 前、bundled Node v24.22.1 随后；没有修改持久 PATH 或安装依赖。证据目录：`C:\Users\likeW\AppData\Local\Temp\navo-f136-20261026`。

| 验证 | 实际结果 |
|---|---|
| 修改前 `pnpm typecheck` | 通过；`baseline-typecheck.log` |
| 修改前 `NAVO_TEST_MODE=all pnpm test --maxWorkers=4` | 158 文件 / 1032 项通过，327.52 秒；含正常 Host、完整 D1–D8 与正文中断恢复；`baseline-tests.log` |
| 新增专项初轮 | 7 项异常测试通过，主场景失败；原因是验收脚本误用未授权 write。修正为答案物化后又暴露脚本错误假设“未关联 Resource 自动出现在 review context”，改为明确读取 Human 物化的成果；未改生产语义 |
| 修正后主场景 | 1 项通过，6.45 秒；`flow-tests.log` |
| 新增脚本类型检查及零推理预检 | 类型检查通过；含正文 ready 显式断言的最终 preflight 通过，0 生成 / 0 Embedding 请求，证据 `C:\Users\likeW\AppData\Local\Temp\navo-f136-real-ftyYmc\evidence`；`preflight.log` |
| 最终完整类型检查 / 全套 | 类型检查通过；161 文件 / 1041 项全部通过，314.29 秒，含完整中断恢复；`final-typecheck.log`、`final-tests.log`。最后的请求计数调整及入口提示修改后再次 typecheck 通过，新增专项 3 文件 / 9 项通过，11.91 秒；`current-typecheck.log`、`library-final.log` |
| 真实模型任务 | 用户明确授权后仅执行一次；资料导入、正文和 3 次 Embedding HTTP 200 成功，随后三份图谱构建因订阅参数不兼容失败。3 次本地生成适配器尝试在联网前拒绝，生成 HTTP 请求 0；821ms 后入口失败停止。Main / Node / Review 未运行。BUG-031 已登记，见 [157](157-bugfix-bug-031-graph-subscription.md)；未修复、未重跑 |
| Bridge / Renderer | 按本次用户范围不运行、不修改；不影响前端单独安排 |

离线检索错误专项为受控故障注入，不冒充外部服务真实故障。真实入口另外复现了 GraphExtractor 与订阅适配器的不兼容 BUG-031；证据和源码根因已登记，没有修改生产代码或重跑。已有 BUG-019 / BUG-025 状态不变。真实现场保存在 `C:\Users\likeW\AppData\Local\Temp\navo-f136-real-ERHQta`，最终预算账本为 `evidence\requests.json`。

## 坑与发现

完整任务不能只看工具注册或 JSON 值；必须核对实际工具结果、提交状态、Main 决定与共享。只读 Node 的输出交接需要显式标出可信物化者，避免验收驱动代码越权替 Agent 实现未有的能力后仍宣称自主完成。

## 下一步

后端离线链路已通过；真实链路受 BUG-031 阻断，等待用户单独决定修复。F13.6 父项保持进行中，不改变前端状态；验收资产可审查，但不能因 CI 或离线通过而把真实门槛记通过。脚本和测试机制随最终回复交付。
