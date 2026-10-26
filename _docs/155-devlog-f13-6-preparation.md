# 155：F13.6 验收准备与缺口盘点

日期：2026-10-26。盘点基线：最新 master `4b6d00b`。本轮只阅读代码、测试与记录，检查本地环境并制定执行计划；未执行测试、模型请求、Embedding 请求或 GPU 实验，未修改生产代码。F13.6 保持进行中，以下执行步骤均等待用户选择。

## 做了什么

已读取 `AGENTS.md`、PRD、前后端计划、Bug 表与 [153](153-devlog-f13-4c-resource-discovery.md)、[154](154-devlog-f13-6-acceptance-plan.md)；当前仓库不存在 `CLAUDE.md`。开始时 master 工作区干净；fetch 后从 `5dc64a8` 快进到 `4b6d00b`，仅同步上游已有文档。本记录、后端计划下一步及索引是本轮的文档变更。

### 可直接复用的验收资产

下表表示已检查测试代码和关键断言，**不表示本轮运行通过**。153 记录的历史基线为 Node 24、158 文件 / 1032 项、314.36 秒；当前提交的结果仍须执行后记录。

| 能力 | 现有入口 | 可以复用的覆盖及边界 |
|---|---|---|
| 长期任务与重规划 | `tests/integration/longterm.spec.ts`、`longterm/script.ts`；真实入口 `scripts/longterm.ts` | Main 规划、Node 分工、阻塞、插入验证节点、定向共享、list 后 fetch、Human Gate、Session 隔离。尚未组合 search_resources 与真实索引；离线脚本预设模型响应，不证明自主选择工具 |
| Main Review 与返工 | `tests/integration/rework.spec.ts`、`rework/script.ts`；`tests/project/runtime/mainreview.spec.ts`、`submission.spec.ts`、`answer.spec.ts`、`tests/node/review.spec.ts`；真实入口 `scripts/rework.ts` | 提交后待确认、Main 查阅成果、complete / rework / skip / escalate、不判定时保持待审、返工意见进入下一 Turn、两次返工上限、版本变化使判断失效、两次同库重开。既有真实五场景与部分返工回合曾获免除，不能据此视为 F13 真实模型已验收 |
| Node 交接 | `tests/integration/resource-handoff.spec.ts`、`tests/tools/resource/handoff.spec.ts`、`tests/integration/compaction/handoff.spec.ts` | A -> Mailbox -> Main 授权 -> B；不直连 Node Session，不因到达资料自动执行。压缩验收的 Main 重新发布公共交接资源属于特定测试做法，不强制推广到所有任务 |
| AutoRun 与长程压缩 | `tests/integration/autorun.spec.ts`、`tests/integration/compaction/`；`scripts/autorun.ts`、`scripts/compaction.ts` | 暂停 / 失败 / 新 run、依赖与跳过、压力压缩、超窗与检查点恢复；复用现有机制，不再造长程框架。F12.7 历史真实成功不代表 F13 检索任务成功 |
| 资料发现与权限检索 | `tests/tools/resource/list.spec.ts`、`search.spec.ts`、`discovery.spec.ts`；`tests/resource/retrieval/`、`tests/resource/access.spec.ts` | 先权限后分页、真实 SQLite + 离线 Embedding / 图谱、目录与跨项目过滤、直接 fetch、隐藏标题 / 片段 / 关系证据不泄露、查询期间撤权、替换删除、空结果与错误区分。Main 可以看同项目 Node 私有资料；Node 只能看自身、定向共享及项目 public 资料 |
| 取消与休眠 | `tests/project/runtime/lifecycle.spec.ts`、`recovery.spec.ts`、`tests/agent/cancellation.spec.ts`、`tests/tools/resource/search.spec.ts`、`tests/resource/retrieval/search.spec.ts` | 指定回合取消、取消后不再进入模型下一步、检索 signal 传播及晚响应处理、资料或消息变化不自动启动 Turn。完整 Project Turn 中正在检索时取消仍缺串联证据 |
| 同库恢复与代次 | `tests/project/context/recovery.spec.ts`、`tests/tools/resource/discovery.spec.ts`、`tests/resource/content/recovery.spec.ts`、`tests/resource/index/processor.spec.ts`、`tests/resource/graph/recovery.spec.ts` | Binding / 权限 / 未读返工恢复、当前正文和索引恢复、旧代次及删除排除、失败需显式重试。不能将同进程 dispose / reopen 写成进程强杀恢复 |
| 正式进程恢复 | `tests/host/process.spec.ts` 及 `process/interruption.ts`、`process/content.ts` | 正式子 Host、跨进程 Main / Node 续接且不重放工具、中断 Turn 收尾、正文 SIGKILL 恢复、D1–D8 资产崩溃点及两次重启。默认 all 含完整崩溃组；crash-pr 仅 D6 / D8 一次重启，加正文组，不能等同 D1–D8 |
| 资料管理 Bridge | `frontend/scripts/qa/resource.ts`、`frontend/electron/ipc/resource/tests/controller.spec.ts`、`tests/host/resource.spec.ts` | `qa:resource` 实际经过 preload / IPC / 子 Host，覆盖导入、订阅、改名移动、替换、删除确认、取消；窗口隔离及参数 / 输出校验还需结合专项断言。脚本采用 Mock Host，属于真实 Bridge 调用、离线模型；不是正式资料库页面 |

真实检索小样本入口 `scripts/retrieval/smoke.ts` 会访问 `192.168.99.2:8081`，不是离线测试；已有预算为最多 10 次 Embedding 请求、180 秒。它只测试向量证据并显式断言图路径为空，不覆盖 Agent、Main Review 或真实图谱。当前不执行，也不为 F13.6 单独重复这个 smoke。

### 后端、Bridge 与正式 UI 的实际分层

| 层次 | 当前已具备 | 未具备 / 验收限制 |
|---|---|---|
| 后端服务与 Agent 工具 | 导入、生命周期、正文、目录整理、向量和图局部检索；Main / Node / Main Review 可调用 list / search / fetch | 尚缺这些能力组成完整任务的新增验收证据；真实图谱抽取与检索质量未验收 |
| Host / RPC / Electron Bridge | `rpc/resource.ts`、`frontend/shared/resource.ts` 已提供 browse / follow、文件与目录选择、import、整理、替换、删除、取消 | 没有用户检索、正文重处理或系统默认应用打开的对应 Resource API；不能把 chooseFiles / chooseDirectory 视为页面可用。正式 Host 在 `src/host/main.ts` 向 createApp 传 Embedding、未传 graph；现有长期任务 / 压缩真实脚本也未装配 Embedding 和 graph |
| 正式 Renderer | 项目创建 / 列表 / 详情与 F5.3 布局已接入；通用聊天过程组件可以展示工具事件 | `frontend/src/workspace/project/Workspace.tsx` 中 `nodes = demo ?? []`；正式发送 `disabled={!demo ...}`；消息和资源按钮禁用；项目 Main / Node 流程未接通。`frontend/src` 未发现 desktop.resource 消费。资料库、拖拽 / 目录导入、搜索卡片、打开、状态重处理和 Agent 资料使用过程的正式页面均待实施；预览中的假回复不构成验收 |

前端计划 F5.4–F5.8 与 F13 页面交接仍待实施；F13.1 / F13.2 父项保持进行中。正式项目 Main / Node 对话、路线和审查页面也是产品验收依赖，不能只补资料库按钮就宣布桌面闭环完成。本轮没有桌面运行或视觉检查，以上为代码与计划核对结果。

### 尚未覆盖的关键场景

1. **任务组合**：真实 Resource 索引 -> Node 按主题 search / 按需 fetch 多份原文 -> 发布成果 -> Main 按目标和标准审查 -> 下一 Node 消费交接成果。现有长期脚本主要 list / fetch，现有 discovery 集成主要直接调用工具；二者分别成立不能替代组合验收。
2. **任务内信息缺口**：空搜索、仅文件元数据、正文不可读、来源冲突、检索失败之后，Agent 是否准确表述缺口且不编造。错误码已测，不重复写一套错误映射；新增的是错误进入任务报告和审查结果的链路。
3. **任务内权限和取消**：Node 的报告 / 新成果不能带出未授权标题、片段、正文和图来源；检索中的 Turn 被取消后不得再提交成果或 review。Main Review 采用 Main 权限，不错误要求它对 Node 私有资料不可见。资料中的越权指令不得改变工具身份或授权。
4. **任务恢复组合**：已提交交接点重开后恢复 Session、授权、成果与索引；无显式动作不发任务模型请求，之后可继续审查 / 下游工作。索引后台恢复可能调用配置的 Embedding / 图谱模型，必须与任务自动续跑分开计数；索引已就绪的暂停点重开才可要求总请求数不增长。
5. **真实模型装配**：不能直接把 `longterm.ts` / `compaction.ts` 的成功写成 GraphRAG 成功。需在验收脚本显式传入 embedding、graph，并共用已注册且计数的模型适配器；不为本轮扩大正式 Host 配置。后续若验收必须走正式 Host 的图谱抽取，先单列接入缺口并获实施授权。
6. **产品入口**：搜索公共契约、打开 / 重处理 Bridge 与上述 Renderer 依赖尚缺；登记为待交付 / 阻塞，不能记为运行失败或以 mock 填补。

这些属于已核实的能力 / 覆盖缺口，本轮未复现新的生产代码故障；不新增推测性 Bug，也不修改已有 Bug 状态。BUG-019 的传输诊断不足、BUG-025 的 HTTP 偶发超时保留既有状态；若后续实际失败，先保存原始证据，再按 bug-plan 登记，不自动修复或重跑。

## 关键决策：最小执行流程

使用一个隔离临时 Project、真实 SQLite 和小型人工可核对语料。三份短 Markdown / TXT 分别记录方案指标、预算 / 许可约束及一处相互冲突的数据；另放一份仅元数据文件。权限专项另用 Node 私有、定向共享和另一 Project 的哨兵资料，哨兵值不进入该 Node 提示。

任务例：比较两个候选方案并交付建议。A 综合至少两份资料，列明事实、冲突及缺失的部署成本，发布比较表并提交；Main 检查目标、逐项标准、报告与实际可用原文，再定向共享给 B；B 结合交接成果和约束补充最终建议，发布并由 Main 审查。至少一个明确主题问题必须实际使用 search_resources，原文不足时继续 fetch；不要求每个 Agent 固定按 list -> search -> fetch 顺序执行，已知 ID 可直接读。

确定性脚本覆盖 Main 返工、意见在下一 Node Turn 可见、skip / escalate 等分支；真实模型主场景不强迫模型凭空判返工。冲突无法由资料消解时保留冲突，缺项标记待补或请求 Human，禁止靠测试脚本给出资料之外的正确答案。跨 Node 仅经现有 Mailbox / Main / Resource；使用现有提交与 review，不建设独立引用系统。

```text
[R] Goal + Resource intake
             |
             v
[R] Main planning -> [N] task-level acceptance assertions
             |
             v
[R] Node A: search / fetch -> artifact + submission
             |
             v
[R] Main Review -> rework / complete / skip / Human
             |
             v
[R] grant + Mailbox -> Node B -> artifact -> Main Review
             |
             v
[N] evidence matrix: offline / real model / Bridge / Renderer

[R] cancel / committed pause -> reopen -> explicit Human start
                                      |
                                      v
                         [N] task + retrieval recovery assertions
```

R = 复用现有生产能力；N = 后续仅补验收串联与断言。本轮只产出计划和记录，不创建上述测试 / 脚本。

### 可独立执行的步骤与通过标准

成本均为计划估计，非本轮实测；编写耗时与运行耗时分列。每步记录通过 / 失败 / 未运行 / 阻塞，遇到失败保存现场并停止该链路，不自动开始修复或增加重跑次数。

| 顺序 | 执行内容与前置条件 | 通过标准 | 预计成本 |
|---|---|---|---|
| A 离线基线 | Node 24；复用根目录 `pnpm typecheck` 与 `pnpm test --maxWorkers=4`，显式 `NAVO_TEST_MODE=all` | 两命令退出 0；记录本次确切文件 / 用例数，确认含资产 D1–D8、正文中断与正常 Host 组。已有专项随全套运行，不另重复全套或另跑 D1–D8 | 运行约 6–10 分钟；真实模型 / GPU 请求 0 |
| B 跨资料任务串联 | A 通过；在 `tests/integration/` 现有 MockLLM、SQLite、Resource fixture 上最小补充，生产代码不变 | Main 从目标规划；A search 并实际使用至少两份正文；成果登记、提交后保持待审；Main 检查后作出有效判断；B 只经授权资源 / Mailbox 交接并交付可核对成果；原文支持任务结论。离线结果只证明链路与断言，不证明真实模型自主性 | 编写约 1–2 小时，专项运行约 1–3 分钟；外部请求 0 |
| C 异常、权限与恢复组合 | B 的 fixture 可复用；只补任务串联缺口，底层 ACL / 错误码 / D1–D8 直接引用 A 结果 | 分例判定：空结果和错误不会混淆；元数据不冒充正文、冲突 / 缺项有明确报告；无隐藏资料或 Session 泄露；检索中取消后无后续模型步骤 / 成果 / 审查提交；返工意见进入后续 Turn；已提交交接点同库重开不自启，显式继续成功，当前 list / search / fetch 均排除删除资料。强杀证据仍单独引用 A，不能把本步骤同库重开称作整条任务强杀验收 | 编写约 1–2 小时，专项运行约 1–3 分钟；外部请求 0 |
| D 已有管理 Bridge | 前端依赖已在本机；bundled Node 24 构建。复用 `pnpm --dir frontend typecheck`、`pnpm --dir frontend test`、`pnpm --dir frontend build`；随后在 frontend 中 `pnpm qa:resource`；必要的既有 Project / review 桥接断言引用前端套件 | 参数 / 结果校验、导入与内容状态、整理替换删除、确认与取消、按窗口清理均有本次断言结果；QA 退出 0 且输出 result.json。Mock Host 及窗口隔离单测的范围分别记录；用户搜索、打开和重处理 API 缺失仍为阻塞 | 运行约 3–8 分钟；外部模型 / GPU 请求 0 |
| E 真实跨资料多 Node 任务 | B / C 通过；另行授权验收脚本编写及真实调用；有效订阅登录、已可用 Embedding endpoint、显式 GraphConfig；隔离 SQLite / Workspace，所有任务 / 摘要 / 图谱请求及 Embedding 都纳入预算；不启动新服务 | 人工可核对语料上的 A / Main / B 完整通过；至少两份实际正文支撑结论，冲突及缺项被正确说明；真实 search 结果和图谱来源可核对；全部成果可读；Main 判定符合标准和 Human Gate；在索引就绪、已提交交接点重开，请求数不增长，显式继续完成。不凭工具名或模型自述判通过；超窗 / 大规模 / 中文广泛质量不在本次结论内 | 验收脚本适配约 1–2 小时；运行约 10–20 分钟。预估生成模型 20–35 请求（含图谱 / 摘要），上限 48；Embedding 预估 8–16，上限 20；硬时限 20 分钟，无模型自动重试 |
| F 正式 Renderer | 当前阻塞。先由前端单独交付 F5.4–F5.8 所需项目链路、F13.1 / F13.2 页面与搜索等缺失契约；不由验收任务顺手实施 | 在正式 Electron 页面完成导入 / 目录 / 状态 / 重处理 / 打开 / 整理 / 搜索定位、项目 Main / Node 执行与 Review、查看真实资料工具过程，并验证取消 / 切换 / 重启反馈；截图与实际后端记录相符，无预览假数据。未交付时只能报告已验证层通过 | 交付后交互检查估计 30–60 分钟；开发成本另行评估。真实桌面模型请求另报预算授权，不能复用 E 的授权 |

执行顺序为 A -> B -> C -> D -> E；F 等依赖就绪后独立执行。B / C 若新增测试，只在独立 Step 分支修改测试 / 验收脚本与开发记录；本地完整检查与当前 PR head CI 按仓库门禁执行。不因这份计划授权任何代码实施、运行或合并。

E 的额度边界：当前 `scripts/acceptance.ts` 使用 ChatGPT 订阅适配器，生成模型消耗账号额度，不能把请求数直接换算成金额；本轮未读取账号剩余额度。Embedding 会占用已有服务的 GPU 推理时间，本轮没有探测远端服务。采用 gpt-6-luna 为沿用现有入口的暂定方案，运行前需重新报告模型、实际装配、总请求上限、时限及额度影响并获得明确授权；若换成计费 API，另按实际模型单价和 token 预算报费用。预算应包含成果入库后的自动正文 / 图谱构建；48 次模型请求不能再额外叠加未计数图谱调用。

预算控制复用 `scripts/compaction/request.ts` 的 RequestLedger、guarded adapter 和 deadline；它现有 kind 只有 task / summary，图谱调用须在验收报告中另行归类，不能冒称已有专用图谱计数。失败保留 evidence、数据库、Workspace 和工具轨迹；不因失败自动重新抽取 / 跑第二轮。

### 环境与证据要求

- 当前默认 `node` 是 `C:\Users\likeW\AppData\Local\pi-node\current\node.exe`，实测 v22.23.1；根包要求 >=24。本机 bundled Node `C:\Users\likeW\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe` 实测 v24.22.1。执行前只在当前进程临时调整 PATH，Windows System32 在前、bundled Node 随后，结束恢复；本轮没有修改 PATH 或安装依赖。
- 根目录和 frontend 的 node_modules 均存在，但未验证安装完整性，也未构建。`NAVO_TEST_MODE` 当前未设置。需要实际运行时显式选择 all，防止仅 normal 或 CI 精简 crash-pr 被误写成完整中断验收。
- 每步最小证据：基线提交、命令、运行环境、退出码、断言结果及失败点。任务另记 Project / Node / Session / Turn、可见资料、实际工具参数和结果、正文 / 成果、Main 判定、请求量与用时；用现有 Session 记录和 evidence 工具，不建设新的追踪系统，不计算哈希。

## 坑与发现

最易误判的是把旧脚本名称、Bridge 的 executeJavaScript 调用、离线固定响应或历史全套成功当成当前真实任务 / 正式 UI 成功。当前没有足以宣布 F13.6 通过的新运行证据；本记录仅完成准备。

## 下一步

等待用户选择 A–F 中具体执行步骤。建议先执行 A，确认当前离线基线，再单独确认 B / C 的验收补充范围。未经授权不执行真实模型 / Embedding / GPU，不补正式 Host 或 Renderer，不开始 F13.5，不建设 Working Board、独立证据评估或引用追踪。
