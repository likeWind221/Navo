# Bug 跟踪与修复计划

此文档是 Bug 修复状态的单一事实源；功能阶段继续在 [后端计划](backend-plan.md) 和 [前端计划](frontend-plan.md) 管理。勾选表示修复验收完成，合并代码不等于修复 Bug。维护规则见 [AGENTS.md](../AGENTS.md)。

## 当前状态

- [ ] BUG-039：DeepSeek 流式返回 `usage: null` 时解析器抛错，阻断真实问答；离线修复与真实复验待完成，见 [183](183-bugfix-bug-039-stream-usage.md)。

- [ ] BUG-038：F5.4 首轮完整前端检查中一项 Mock Host 启动超时；master / 分支定向及分支完整复验通过，原因未确认，等待复现，见 [170](170-bugfix-bug-038-host-startup.md)。

- [x] BUG-037：独立 master 已复现窄屏项目会话面板2px；最小列定位修复、实际 Electron、前端165项与根1080项、当前 head CI 均通过；PR #112 已合入（ec14333），关闭，见 [169](169-bugfix-bug-037-panel.md)。

- [ ] BUG-036：F5.4 真实 Main 两回合在凭据刷新阶段 AUTH 失败；零生成诊断确认 token 端点 HTTP 403 / application/json。2026-10-27 补充：当前出口直连仍 403，临时干净出口下同一端点返回 200 且 `pnpm chatgpt models` 刷新并列出模型，说明与出口路由 / IP 相关；真实 Main 仍未跑，未修复、未关闭。用户同日明确允许带此已知缺口直接合并 F5.4 PR #111（commit `c8586fa`）；授权仅限本次合并，BUG-036 保持未勾选，后续仍须真实复验，见 [168](168-bugfix-bug-036-auth.md)。

- [x] BUG-035：已按方案 A 修复验收来源契约：直读由成功 fetch 轨迹证明，`source_ids` 只要求可追溯的支持来源并拒绝本回合未出现的 ID；新增三项回归，完整本地 1056 项与 CI run `40334741718` 通过。第四轮真实运行 `%TEMP%/navo-f136-real-R8uzdx` 的 Node B 来源声明与 fetch 轨迹一致，最终 Main Review 与完整任务通过，关闭，见 [163](163-bugfix-bug-035-node-source-evidence.md)。
- [x] BUG-034：验收脚本已补齐 Main 目标确认两回合；第四轮真实确认 / 规划、两 Node、Review 与同库重开通过，完整本地 1056 项与 head `a3fb032` 的 CI run `40335277583` 通过，关闭，见 [162](162-bugfix-bug-034-acceptance-confirmation.md)。
- [x] BUG-033：首轮 OpenRouter 单次 Embedding 触及 15 秒预算；按用户授权改为 60 秒后，第四轮 7 次请求全部 200，完整图谱 / 两 Node / Main Review 通过，关闭；前次超时根因仍未定位，见 [161](161-bugfix-bug-033-openrouter-timeout.md)。
- [ ] BUG-032：2026-10-26 用户决定搁置原 Qwen 端点排查，后续使用 OpenRouter；保留原连接失败事实，不标记已修复，见 [158](158-bugfix-bug-032-embedding-connectivity.md)。
- [x] BUG-031：参数修复已合入；第四轮三份原文及成果图谱全部真实 active，完整两 Node / Main Review 通过，旧错误未复现，关闭，见 [157](157-bugfix-bug-031-graph-subscription.md)。

- [x] BUG-030：Provider / Host 已对齐 Qwen3-Embedding-4B / 2560 维，真实 9 请求 smoke、专项 52 项、完整 988 项及代码 head CI 通过，PR #96 已合入（c6b6ef9），见 [151](151-bugfix-bug-030-embedding-deployment.md)。

- [x] BUG-027：候选校验已合并为一次事务，本地耗时对比、完整 987 项及 PR #95 当前代码 head CI 通过，已合入（83c54fa），关闭；见 [150](150-bugfix-bug-027-029-retrieval.md)。
- [x] BUG-028：已采用完整词边界、最长重叠优先和稳定种子选择；相关回归、完整 987 项及 PR #95 代码 head CI 通过，已合入（83c54fa），规则修复关闭，中文真实质量未验收，见 [150](150-bugfix-bug-027-029-retrieval.md)。
- [x] BUG-029：已独立定义融合结果并使用 fusionScore；类型检查、相关回归、完整 987 项及 PR #95 代码 head CI 通过，已合入（83c54fa），关闭，见 [150](150-bugfix-bug-027-029-retrieval.md)。

- [x] BUG-026：已恢复向量与图谱双路，最终按 Chunk Top-K、每资料最多 3 个并保留全局排名；本机 typecheck、985 项完整测试及 PR #94 当前代码 head CI 通过，已合入 master（408a83c），关闭，见 [149](149-bugfix-bug-026-retrieval.md)。

- [ ] BUG-025：固定地址 HTTP 测试在 F13.3d 首轮完整套件超过默认 5 秒，分支与 master 定向均 7 项通过，同分支完整复验 980 项通过；仅排查、未修复，根因未知，见 [148](148-bugfix-bug-025-fetch-timeout.md)。

- [x] BUG-024：F13.3b 索引复用与恢复版本校验已修复；初次相关 14 项、与图谱组合 39 项及 typecheck 通过；已按用户授权并入 PR #92，组合完整 963 项通过，PR #92 最新 head CI 成功并已按用户授权合入 master（de2bb17），关闭，见 [145](145-bugfix-bug-024-index-compatibility.md)。

- [x] BUG-023：已完成操作重试先核对原提交事件、revision 与目标代次；Resource 后续变化返回 `operation-result-stale`，删除后返回 `resource-unavailable`，删除重试不重复副作用。新增 5 项回归，本机定向 28 项与完整 856 项通过；PR #81 已合并且 GitHub Actions CI 通过。见 [133](133-bugfix-bug-023-replayed-operation-result.md)。

- [x] BUG-020：文件分页回归已显式建立不同 stat token 前提，保留覆盖拒绝和原内容断言；本机完整 851 项及代码 head c345950 CI 851 项均通过，关闭。见 [130](130-bugfix-bug-020-file-version-fixture.md)。

- [x] BUG-021：Host 跨进程续接测试的 mock `completed` 模式只排一个响应，第二个 Turn 耗尽脚本并触发约 15 秒重试退避；原测试未断言续接 Turn 成功。已改为支持多 Turn 并补 `turn-completed` 断言；本机定向、完整 851 项及代码 head `5858f28` 的 CI 851 项均通过，关闭。见 [132](132-bugfix-bug-021-022-ci-timeouts.md)。

- [x] BUG-022：compaction evidence 集成测试沿用默认 5 秒预算，CI 通过/失败分别为 3.205 秒 / 5.266 秒；未发现隐藏等待或重试。已设单项 15 秒预算；本机定向、完整 851 项及代码 head `5858f28` 的 CI 均通过（本轮 2.591 秒），关闭。见 [132](132-bugfix-bug-021-022-ci-timeouts.md)。

- [ ] BUG-019：TRANSPORT 失败只有通用消息，底层 cause 未持久化；17:58 一轮已从 Mihomo 日志定位到代理服务器 TCP 超时，18:08 一轮底层原因仍缺证据。仅排查，未修改网络或代码。见 [123](123-bugfix-bug-019-transport-diagnostics.md)。

- [x] BUG-018：实际 Main / Node Turn 正确关联，真实最终断言、本机完整检查与 PR head CI 通过；PR #79 已合入，关闭。见 [122](122-bugfix-bug-018-review-turn.md)。

- [x] BUG-017：真实 Main 按目的读取精简原始记录及汇总，A / B 分别返回 1596 / 2507 字符，完整验收通过，关闭。见 [121](121-bugfix-bug-017-review-evidence.md)。

- [x] BUG-016：真实两 Node 提交结构被 Main 正确使用，均一次 complete、零返工，完整验收通过，关闭。见 [120](120-bugfix-bug-016-review-submission.md)。

- [x] BUG-015：双事件观察器回归与最新真实审查前暂停、重启、完整完成通过，关闭。见 [119](119-bugfix-bug-015-compaction-pause.md)。

- [x] BUG-014：原工具错配已修订，最新真实 JSON 交接、暂停 / 重启及两 Node / Main 完整完成通过，关闭。见 [118](118-bugfix-bug-014-compaction-acceptance.md)。

- [x] BUG-013：补齐 F11.3 四个错误提示并修正测试命名；前端完整检查、139 测试、Electron bridge 实际调用、根目录 695 测试与代码 head CI 通过（PR #71，收口提交仍执行当前 head CI 门禁）。见 [107](107-bugfix-bug-013-autorun-desktop.md)。

- [x] BUG-012：F11.4 真实验收脚本未调用入口且未提供下游所需材料；已修正，本机完整检查、gpt-6-sol 双节点真实完成及代码 head CI 通过（PR #70，收口提交仍遵循当前 head CI 门禁）。笔记：[106](106-bugfix-bug-012-autorun-acceptance.md)。

未关闭：BUG-002、BUG-007、BUG-010、BUG-019、BUG-025、BUG-032。BUG-002 等待复现，BUG-007 / BUG-032 经用户决定搁置，BUG-010 待 Qwen / Electron 验收，BUG-019 / BUG-025 仅排查、未修复；BUG-031、BUG-033、BUG-034、BUG-035 已因第四轮真实完整任务通过而关闭；BUG-014～018 已随 PR #79 合入关闭，BUG-021 / 022 与 BUG-023 均已满足各自关闭条件。

- [x] BUG-001：Node 续接时未读取已共享的新验证资源（已修复：续接资源变化通知 + Resource ID 语义）
- [ ] BUG-002：验证节点发布文件时出现来源不可用错误（诊断已补齐，未复现；2026-10-07 用户决定保持未关闭，等待复现后依证据定性）
- [x] BUG-003：Agent 文字状态报告与当前领域状态不一致（已修复：陈述前读取或声明未核实）
- [x] BUG-004：真实验收的失败现场留存不足（已修复：逐回合证据落盘）
- [x] BUG-005：未知工具名的报错被模型误读为权限拦截（已修复：先查注册表再判白名单，未知名字返回 unknown-tool 与可调用列表）
- [x] BUG-006：真实模型频繁产生格式错误的工具名（已处理：定位为模型输出；改名 `create_roadmap` 降低触发，`unknown-tool` 反馈保证同回合恢复）
- [ ] BUG-007：thinking 推理耗尽输出 token 上限导致回合 blocked（2026-10-09 登记，未排查；同日用户决定搁置：大概率是 qwen3.8-27b 思考过长的模型特性）
- [x] BUG-008：shell 取消在 CI 上偶发挂起至 `close` 超时（2026-10-11 登记；2026-10-12 已修复：根因为 taskkill 枚举进程树时漏杀 pwsh 正在创建的子进程，改为 shell 先进入 `KILL_ON_JOB_CLOSE` 作业再执行命令，并保留 1 秒排空兜底）
- [x] BUG-009：Responses 工具 namespace 缺少必填 description，真实订阅请求返回 HTTP 400（M1.4 已补齐；真实文本/read、本机完整验证与当前 head CI 通过，PR #54 已合入）。笔记：[92](92-bugfix-bug-009-namespace.md)。
- [ ] BUG-010：gpt-6-luna 为 `create_roadmap` 生成跨 Node 分支字段，运行时连续拒绝，真实 Project 无法创建 Roadmap（2026-10-15 已删除控制节点并把 Roadmap 修改工具按动作拆分；gpt-6-luna / gpt-6-sol 真实复验规划与修改计划均通过，Qwen 对照与 F5.4 Electron 验收待本机）。笔记：[95](95-bugfix-bug-010-roadmap-schema.md)。
- [x] BUG-011：重启后节点列表从创建顺序变为 ID 顺序（2026-10-15 F10.5 发现；同日修复：存储按每个 owner 首条事件的写入顺序回放，资源列表经核实本不受影响）。笔记：[99](99-bugfix-bug-011-restart-order.md)。

## Bug 明细表

优先级：P1 阻断目标闭环，P2 影响诊断或报告可信度。优先级不代表已确认生产代码缺陷。

| ID | 优先级 / 所属端 | 现象与影响 | 证据与归因状态 | 关闭条件 | 笔记 |
|---|---|---|---|---|---|
| BUG-039 | P1 / 后端 LLM | DeepSeek 流式生成遇到 null usage 时中断 | 真实预检报 TypeError；本地构造 SSE 复现，根因是只跳过 undefined | null 和缺失不导致中断，最终用量与未知用量正确，非空错误明确；本地完整、当前 head CI 与真实 Flash 复验通过 | [183](183-bugfix-bug-039-stream-usage.md) |
| BUG-038 | P2 / 前端 Host 验证 | 首次 Mock Host 启动超过 5 秒预算 | 原日志保留；同 master 定向、分支定向和完整 176 项复验均通过；原因未知，未修复 | 复现时取得启动证据，定位并修复后同场景稳定通过及当前 head CI 成功；单次复验不自动关闭 | [170：仅排查，待复现](170-bugfix-bug-038-host-startup.md) |
| BUG-037 | P1 / 前端布局 | 547px 窗口的项目会话面板极窄，无法阅读或输入 | 独立 master 已复现2px；修复后350px，原生交互、前端165项、根1080项与CI 40367528661通过；PR #112合入ec14333 | 主线复现后最小修复，宽 / 窄屏实际可见与点击通过，本机及当前 head CI 成功并合并 | [169：已修复并合入](169-bugfix-bug-037-panel.md) |
| BUG-036 | P1 / 后端认证与外部依赖 | 既有 ChatGPT 凭据刷新被拒绝，阻断 F5.4 真实 Main 规划 | 已证实两个 AUTH 失败 Turn 与 token 端点 HTTP 403；本地 connected 不等于服务端可用；2026-10-27 干净出口下同一端点 200、刷新与 models 成功，确认与出口路由 / IP 相关，服务端拒绝原因仍未确认 | 明确可用认证链后，在新隔离库通过预填 / 空目标真实 Main 确认规划；涉及代码时须完整本机与当前 head CI | [168：仅排查，未修复](168-bugfix-bug-036-auth.md) |
| BUG-035 | P1 / 后端验收脚本 | Node B 将搜索 / 上游来源混入本回合直接读取声明 | 已确认判据（至少两份真实 fetch）与检查（source_ids 只能列 fetch）不同义；按方案 A 改为轨迹证明直读、source_ids 只校验可追溯性，并补三项回归 | 必读来源实际 fetch、来源声明可追溯，并完成最终 Main Review 和完整任务；第四轮真实运行通过 | [163：已修复并真实复验通过](163-bugfix-bug-035-node-source-evidence.md) |
| BUG-034 | P1 / 后端验收脚本 | 脚本未经历目标确认就断言两个 Node | 已补齐两回合；第四轮真实确认 / 规划、两 Node、Review 与同库重开通过，本地 1056 项与 head `a3fb032` CI 通过 | 修正后真实目标确认 / 规划及后续任务、本地完整检查与当前 head CI 通过 | [162：真实复验通过，关闭](162-bugfix-bug-034-acceptance-confirmation.md) |
| BUG-033 | P1 / 后端验收依赖 | OpenRouter 单项 Embedding 曾触及验收 15 秒预算 | 改为 60 秒后，第四轮 7 次请求全部 200；完整任务通过；前次 15 秒超时根因未定位 | 实际 Embedding 与完整图谱 / 两 Node / Main Review 任务通过 | [161：调整时限后完整通过，关闭](161-bugfix-bug-033-openrouter-timeout.md) |
| BUG-032 | P1 / 后端验收依赖 | 原 Qwen 端点未收到 HTTP 响应 | 2026-10-26 用户决定搁置排查，后续使用 OpenRouter；原端点未修复 | 若恢复使用原端点，另行定位并完成真实验收 | [158：用户决定搁置](158-bugfix-bug-032-embedding-connectivity.md) |
| BUG-031 | P1 / 后端 | 图谱固定参数曾被订阅适配器在联网前拒绝 | 参数修复已合入；第四轮 5 次图谱请求、全部成果图谱 active，完整两 Node / Main Review 通过，旧错误未复现 | 参数修复、完整本地与当前 head CI，以及重新授权后的真实图谱 / 多 Node / Main Review 通过 | [157：完整真实任务通过，关闭](157-bugfix-bug-031-graph-subscription.md) |
| BUG-030 | P1 / 后端 | 默认 0.6B / 1024 维与已部署的 4B 不一致，阻断真实索引验收 | 已适配；真实 9 请求 smoke、完整 988 项及代码 head CI 通过 | Provider / Host 对齐部署，维度及响应校验、本地完整验证、真实 smoke test 与当前 PR head CI 通过 | [151：已修复并合入 PR #96](151-bugfix-bug-030-embedding-deployment.md) |
| BUG-027 | P2 / 后端 | 每个候选单独 atomic，存在不必要事务开销；不是已测出的性能故障 | 已核实 atomic 无外层时逐次提交，本机对比候选阶段 37→1 次 | 单次事务完成候选校验，结果排名与权限/代次规则保留；耗时对比、完整本机与当前 head CI 通过 | [150：已修复并合入 PR #95](150-bugfix-bug-027-029-retrieval.md) |
| BUG-028 | P2 / 后端 | 中文短实体可被子串误命中，截断种子受图读取顺序影响 | 已确认 includes 与先截断的规则 | 完整词边界、最长重叠与稳定截断回归、完整本机与当前 head CI 通过；注明分词边界 | [150：已修复并合入 PR #95](150-bugfix-bug-027-029-retrieval.md) |
| BUG-029 | P2 / 后端契约 | RetrievalChunk 继承 IndexSearchResult，score 的余弦/RRF 含义混淆 | 类型继承与赋值已核实 | 独立结果类型与明确融合分数字段，调用更新及完整本机与当前 head CI 通过 | [150：已修复并合入 PR #95](150-bugfix-bug-027-029-retrieval.md) |
| BUG-026 | P2 / 后端 | 独立关键词召回偏离双路方案，默认最多 50 个 Chunk 超出上下文预期 | PR #93 的 lexical 分支、Resource 分组后截断和每组 5 个已核实 | 删除独立关键词通道；全局 Chunk Top-K、每资料最多 3 个、排名可恢复；相关回归、完整本机及当前 head CI 通过 | [149：已修复并合入 PR #94](149-bugfix-bug-026-retrieval.md) |
| BUG-025 | P2 / 后端测试 | 固定地址 HTTP 连接测试在首轮完整套件超过默认 5 秒 | 本轮未改动测试或 Fetch 网络代码；定向 7 项通过；并发负载或调度仅为假设，未确认根因 | 定位原因并完成必要修复；相关回归、本机完整与当前 head CI 通过 | [148：排查记录](148-bugfix-bug-025-fetch-timeout.md) |
| BUG-024 | P2 / 后端 | 旧 Chunker / 向量编码索引可能被错误复用，旧 Chunker 的 building 可能恢复发布 | 已证实 needsBuild 手写条件遗漏两项版本；recoverable 仅比较 Provider，遗漏 Chunker 且未废弃不兼容记录 | 两入口复用完整兼容判断；不兼容 building 先 superseded 再重建；两版本的 active / building 回归、typecheck 与 diff 检查通过 | [145：修复与验证](145-bugfix-bug-024-index-compatibility.md) |
| BUG-023 | P1 / 后端 | 同一已完成操作重试可能返回替换后的代次、后续 revision 或已删除 Resource，冒充原操作结果；删除重试未核对原删除事件 | 已证实 `write()` 只按 `resource_id` 读取当前投影，未核对提交事件、revision 与目标代次；`projector` 删除后保留 Resource 主体。新增回归复现替换、改元数据、删除三类错误返回 | 重试核对提交事件、请求身份、提交 revision 与目标代次；状态变化返回 `operation-result-stale`，删除后返回 `resource-unavailable`，删除重试不重复副作用；定向、本机完整及当前 head CI 通过 | [133：修复与验证](133-bugfix-bug-023-replayed-operation-result.md) |
| BUG-021 | P2 / 后端测试 | Host 跨进程续接测试在 CI 达到 20 秒上限；失败 Turn 未使测试失败 | 成功 run 17.969 秒、失败 run 20012 ms；阶段计时显示第二次 Host 的 `continue-node` 约 14.956 秒；默认 `completed` mock 只排一个响应，第二个 Turn 触发 `script-exhausted` → `stream-failed` 重试退避 | 续接 Turn 真实以 `turn-completed` 结束；定向回归、本机完整及当前 head CI 通过 | [132：复盘与修复](132-bugfix-bug-021-022-ci-timeouts.md) |
| BUG-022 | P2 / 后端测试 | compaction evidence 集成测试在 CI 达到默认 5 秒上限 | 成功 run 3.205 秒、失败 run 5.266 秒；本机阶段合计约 0.91 秒；`maxModelRetries: 0`，无固定等待或锁等待 | 显式单项预算并保留全部断言；定向回归、本机完整及当前 head CI 通过 | [132：复盘与修复](132-bugfix-bug-021-022-ci-timeouts.md) |
| BUG-020 | P2 / 后端测试 | 分页跨版本回归在 Windows CI 偶发允许覆盖，阻断完整检查 | run 39267061717 为真实断言失败；测试未确保等长写入的 mtimeNs 不同；既有 stat token 契约见 21。未保留原失败现场 stat，时间碰撞为与实现一致的归因，非已测得原始值 | 显式建立不同 stat 版本前提，保留拒绝写入及内容不变断言；定向、本机完整及当前 head CI 通过 | [130：修复笔记](130-bugfix-bug-020-file-version-fixture.md) |
| BUG-019 | P2 / 后端诊断 | 模型连接失败现场只有通用 TRANSPORT，不能区分底层超时、重置或 TLS | OpenAIAdapter 保留 cause，normalizeFailure 与验收账本未持久化；根因已确认。外部链路方面仅第一轮对应代理服务器 TCP 超时，第二轮未定位 | 在不暴露凭据或完整请求的前提下保留必要连接失败分类，定向回归与本机 / 当前 head CI 通过；不以自动重试代替诊断 | [123：排查笔记](123-bugfix-bug-019-transport-diagnostics.md) |
| BUG-018 | P1 / 后端验收 | Node 完成后，脚本仍可能找不到 Main 审查 Turn 而误判失败 | review.lastReview.turnId 属于被审查 Node；定向 App 回归复现，已改为按 Main 请求中的系统 checklist 关联 Node ID、Node Turn 与被审查版本 | 两 Node 审查对应不同 Main Turn 的回归、本机完整检查与当前 head CI 通过；随当前阶段 PR 合入 | [122：修复笔记](122-bugfix-bug-018-review-turn.md) |
| BUG-017 | P1 / 后端验收 | Node B 正确提交，但 Main 只能看到截断原始读结果，无法独立核验数值而升级 | 唯一 Resource 是 summary；原始批次未交接。Main 有 register / fetch 能力但未使用，且最终断言禁止全部 Turn 注册证据；确认验收证据入口与限制错配；已补精简证据与无资源审查规则，最新完整真实 A / B 审查均通过，零返工 | 保留独立核验，明确允许的证据读取流程；定向回归、本机完整检查、真实两 Node / Main 完成与当前 head CI 通过 | [121：排查笔记](121-bugfix-bug-017-review-evidence.md) |
| BUG-016 | P1 / 后端审查 | 合法提交已含自检索引与布尔值，Main 仍因截断日志不可核验而两次返工后升级，阻断 F12.7 | 三次原始 criteria 正确，9 次实际请求均含自检且 Main 未压缩；已将自检放回带来源的 completionSignal，系统规则区分结构事实与业务声明。定向、本机完整与最新真实两 Node / Main 完成均通过 | 明确结构事实与任务证据边界，定向回归保留内容独立核验，不强制 complete；本机完整检查、真实两 Node / Main 完成及当前 head CI 通过 | [120：排查与修订](120-bugfix-bug-016-review-submission.md) |
| BUG-015 | P1 / 后端验收 | Node 已提交，但验收观察器未在 Main Review 前请求暂停，无法按协议交接与重启 | Node.endWork 在 Session turn-ended 后发生；只监听 session/event 无法观察最终 submitted；Luna 正确 JSON、两次压缩与提前 Main escalate 现场已保存 | 旧代码失败的真实 App 回归通过；监听 Node 提交后正确暂停、释放订阅；本机完整检查与当前 PR head CI 通过，真实交接/重启/完成复验通过 | [119：排查修复笔记](119-bugfix-bug-015-compaction-pause.md) |
| BUG-014 | P1 / 后端验收 | F12.7 要求 Node 写出 JSON，但 Node 未获 write，无法注册产物及完成 Project | 实际任务请求工具列表及 Node Profile 均无 write；三次 register_resource 因源文件 ENOENT 失败。已确认验收协议错配，不归因为压缩失败；现已改为原始 JSON 提交与脚本交接，完整真实验收未通过 | 验收所需能力与实际公开工具一致，预检查可拦截错配；修订协议后本机完整验证、真实多次压缩 / 重启 / 两 Node 完成与 PR head CI 通过 | [118：排查笔记](118-bugfix-bug-014-compaction-acceptance.md) |
| BUG-013 | P1 / 前端 | F11.3 前端类型检查失败，默认测试未运行 AutoRun handler 场景 | TS2366 已复现；四个错误码缺少提示分支，`.test.ts` 不匹配 `.spec.ts` 发现规则均已确认 | 前端完整 typecheck/test/build 通过，四项测试被发现，真实 Electron bridge 验证通过；完整本地检查及当前 PR head CI 通过 | [107](107-bugfix-bug-013-autorun-desktop.md) |
| BUG-012 | P2 / 后端验收 | AutoRun 真实脚本空退出，补齐入口后空材料导致下游等待，不能证明完成链路 | 入口缺失、空 Workspace 与无共享 Resource 均已确认；原真实现场已保留 | 入口真实执行并在失败时非零退出；有效输入下两个 Node 经 Main 判完成；本机检查与当前 head CI 通过 | [106](106-bugfix-bug-012-autorun-acceptance.md) |
| BUG-001 | P1 / 后端 | synthesis 续接仍读取旧 evidence，报告缺少 validation，无法产出最终推荐 | 首次有效运行第 8 回合；Store 权限检查通过，但未留存该回合请求快照。上下文传递遗漏、模型漏读或旧历史干扰均待确认。2026-10-07 证据确认：新 Resource 已在续接提示中，失败为模型被历史“缺失”结论压过并把名称当 ID；修复后续接 8/8 成功（run 6-13），Resource 引用加固后工具调用零失败 | 留存该回合模型输入和调用结果，定位并处理原因；真实模型读取新 Resource 并形成有依据的结论，同时保持原 Session 和 Human Gate；笔记记录完整复验 | [发现记录](66-devlog-f9.8-longterm-acceptance.md)、[登记与排查边界](67-devlog-bug-tracking.md)、[修复笔记](68-bugfix-bug-001-004-longterm.md) |
| BUG-002 | P1 / 后端 | validation 注册文件时出现 `Resource source file is unavailable`；模型随后恢复，但严格验收在第 6 回合停止 | 第二次有效运行；未留存失败调用的 path 和底层 I/O 原因。该消息可来自 realpath/stat 的 I/O 失败，不能据此断言一定是模型猜错文件名。2026-10-07：错误已携带 path 与 errno，验收改为“不得有未恢复错误”；run 2-13 均以正确路径注册成功，原错误未复现，原因仍未证实 | 捕获实际参数及失败原因，明确输入文件交接与工具错误恢复的预期；处理已证实问题，真实场景能正确发布/读取所需文件；明确可恢复工具错误的验收标准，不能仅删断言以通过 | [发现记录](66-devlog-f9.8-longterm-acceptance.md)、[登记与排查边界](67-devlog-bug-tracking.md)、[修复笔记](68-bugfix-bug-001-004-longterm.md) |
| BUG-003 | P2 / 后端 | Main 在 synthesis 实际 idle 时仍报告 locked，误导用户下一步操作 | 首次有效运行的交接回复；属于可观察的文本与事实不一致，具体提示、历史或查询使用原因待确认。回合内 working 与回合后 idle 的正常转换不算此问题。2026-10-07：确认原因是人工确认发生在 Main 对话外且提示无重读规则；修复后状态探针 10/10 本回合读取并答 idle，Main 另收节点状态变化提醒 | 关键状态报告基于当前可信事实；以实际状态转换场景验证报告一致，无法确认时表达未知；保留真实复验文本与对应快照 | [发现记录](66-devlog-f9.8-longterm-acceptance.md)、[登记与排查边界](67-devlog-bug-tracking.md)、[修复笔记](68-bugfix-bug-001-004-longterm.md) |
| BUG-004 | P2 / 后端验收脚本 | 失败输出仅含工具名称与错误摘要，缺少具体参数和关联上下文；应用释放后不能还原现场，妨碍 BUG-001/002 定位 | `scripts/longterm.ts` 已增加请求资源 ID 摘要，但首次失败未有此摘要；未持久化失败所需事件。此诊断缺口已确认。2026-10-07：逐回合证据与 failure.json 已用于定位 BUG-001 | 失败时留下足以关联 Turn、输入资源元数据、工具参数、结果和状态的脱敏证据；复现后可区分上下文、模型选择与 I/O 错误，不泄露凭据或记录无关数据 | [登记与排查边界](67-devlog-bug-tracking.md)、[修复笔记](68-bugfix-bug-001-004-longterm.md) |
| BUG-005 | P2 / 后端 | 模型输出不存在的工具名时，ToolService 返回 “Tool '…' is not allowed for this Turn.”，模型把它理解为平台权限拦截而放弃操作；F9.10 五场景第 5、6 轮因此规划未落盘 | F9.10 真实模型验收（`scripts/goal.ts`，qwen3.8-27b）。报错文案未区分“工具不存在 / 名称格式错误”与“本回合未授权”属已观察事实；文案是否为主因、其他模型是否同样误读待确认。当前由 Main 提示词规则 2 规避。2026-10-08 确认根因：ToolService 先判白名单后查注册表，未注册名字一律落入 `tool-not-allowed`；修复后去掉规则 2 真实复验 5 轮，3 次残缺名均收到 `Unknown tool` 并同回合恢复 | 未知或格式错误的工具名与真正的权限拒绝返回可区分的错误，提示模型修正重试；真实模型复验在不依赖提示词规避的情况下能自行恢复；保留复验记录 | [74：F9.10 开发记录](74-devlog-f9.10-goal-confirm.md)、[修复笔记](76-bugfix-bug-005-unknown-tool.md) |
| BUG-006 | P2 / 后端 | 真实模型多次输出形如 `write_\n<parameter=...` 的残缺工具名，导致调用失败，需模型重试；F9.10 最终版两轮出现 4 次 | F9.10 五场景与 F9.10 首轮记录均有出现；BUG-005 复验又见 `write_` + 换行 + `oadmap` 形态（[76](76-bugfix-bug-005-unknown-tool.md)）。2026-10-09 已定位：原始 SSE 显示 vLLM 单个 delta 整段下发残缺名，排除适配层拼接；非流式 logprobs 显示模型在 `write_` 后以 0.65–1.00 概率生成换行符 `
| BUG-007 | P2 / 后端 | 开启 thinking 时，模型在单步内推理约 3.1 万字符，耗尽 8192 输出 token，没有调用工具也没有回答，回合以 `max-tokens` 结束为 blocked；用户已同意的规划没有执行 | BUG-006 复验 goal 第 2 轮 `extract-goal` 第 2 回合（证据为本机 scratchpad 的 `probe/after/goal-2/extract-goal-2.json` 与对应原始 SSE）。仅出现 1 次；推理过长的诱因、上限配置是否合理、blocked 后的恢复路径均未排查。2026-10-09 用户决定搁置：判断大概率是 `qwen3.8-27b` 思考过长的模型特性，暂不排查；更换模型或再次出现时重新评估 | 明确 thinking 模式下的输出预算与超限处理；真实场景中不因推理耗尽而丢失用户已同意的操作，或能给出可恢复的提示；保留复验记录 | [77：BUG-006 笔记](77-bugfix-bug-006-malformed-tool-name.md) |
| BUG-008 | P2 / 后端 | Windows 上取消或超时正在运行的 shell 命令后，`runShellCommand` 偶发收不到子进程 `close`，CI 测试等满 5 秒超时；生产中回合会卡到残留进程自行退出，且被取消的命令在后台继续运行 | PR #43 的 CI 失败 2/3 次；2026-10-11 带诊断的 CI 运行未复现。2026-10-12 本机冷启动全量测试 15 轮 1 次挂起，现场：taskkill 返回 0、shell 已 exit、测试启动的 node 存活且父进程已死。已证实根因：`taskkill /T` 枚举进程树时漏杀 pwsh 正在创建的子进程（pwsh 7 启动后 200ms 结束 7–9/10 漏杀，5.1 为 0/10）。修复：shell 先进入 `KILL_ON_JOB_CLOSE` 作业再执行命令（失败退回原行为），`exit` 后 1 秒排空兜底；本机漏杀 0/10，冷启动多轮全量测试 0 挂起、0 残留 | 采集失败现场并确认根因；修复或证明不属于生产缺陷；修复后在 CI 上连续多轮完整套件无挂起并保留记录 | [排查与修复笔记](80-bugfix-bug-008-shell-cancel.md) |
| BUG-009 | P1 / 后端 | 真实订阅请求因工具 namespace 缺少 description 返回 HTTP 400 | gpt-6-luna 返回 missing_required_parameter；补齐后文本及 read 续接通过，根因已确认 | 真实文本/read、协议回归、本机完整检查和当前 head CI 通过 | [92：修复笔记](92-bugfix-bug-009-namespace.md) |
| BUG-010 | P1 / 后端 | gpt-6-luna 在目标确认后无法创建 Roadmap，阻断真实 Project 规划与 F5.4 收口 | F5.4 两个独立 Project 均复现：模型为 control 节点发送 `goal` / `done_when`，也曾为 work 节点发送 `control`；运行时按互斥联合拒绝。直接失败点已确认：工具向模型公布的扁平 Schema 允许这些字段，条件约束只写在描述里 | 工具 Schema 与运行时约束一致；非法跨分支字段仍被拒绝；后端目标确认真实验收和 F5.4 预填/空目标 Electron 真实验收均能创建 Roadmap | [95：排查与修复笔记](95-bugfix-bug-010-roadmap-schema.md) |
| BUG-011 | P2 / 后端 | 重启后 `getByProject` / `listByProject` 的顺序改变，资源列表 RPC、Main 项目事实、节点可见资源和复盘清单的顺序随之改变；数据不受影响 | F10.5 场景观察到节点顺序改变；已证实恢复时按 `ORDER BY owner_id, seq` 读取，Store 按读取顺序插入 `Map`。UI 上的影响根据代码推断，未实际观察。2026-10-15 已修复：按 owner 首条事件 rowid 回放；资源列表经核实本不受影响 | 重启前后上述列表及依赖它们的 RPC、模型上下文顺序一致；有重启顺序回归测试；F10.5 测试改回严格比较 | [99：排查与修复笔记](99-bugfix-bug-011-restart-order.md) |

## 处理时间线

2026-10-20：F13.1a 收尾审查发现 BUG-023：已完成操作的重试路径只按 `resource_id` 返回最新 Resource，不核对原提交事件与版本。修复新增共享的“操作记录 ↔ 提交事件”核对，状态已变化返回 `operation-result-stale`，Resource 已删除返回 `resource-unavailable`，删除重试先核对原删除事件。新增 5 项回归；本机定向 28 项与完整 856 项通过（本机 Node 22.23.1，未达项目 Node ≥24 基线）；PR #81 的 GitHub Actions CI 已通过并合入 master。详见 [133](133-bugfix-bug-023-replayed-operation-result.md)。

2026-09-22：登记 4 项未关闭问题，尚未实施生产修复。用户明确要求将已发现问题转入此表后先合并 F9.8 阶段成果；本次允许带已知真实验收失败合并，不改变后续验证门禁，也不声称真实模型闭环已通过。阶段交付见 [PR #30](https://github.com/likeWind221/Navo/pull/30)。

2026-10-07：分支 `fix/bug-001-004-longterm` 完成排查与修复，本机共 13 次真实运行：加入续接变化通知后，续接 8/8 成功；加入名称解析与 resource_id 枚举后，Resource 工具调用零失败；随后把变化通知重构为通用 system-reminder，并推送 Main 节点状态变化。BUG-001、003、004 达到关闭条件；BUG-002 的诊断能力与验收口径已落地，但原错误未复现，保持未勾选。代码以 PR 合并为准，详见 [68：修复笔记](68-bugfix-bug-001-004-longterm.md)。

2026-10-08：F9.10 真实模型验收中发现 BUG-005、BUG-006，当前仅靠 Main 提示词“同意后失败调用修正重试”规避，未修改内核或适配层。证据见 [74：F9.10 开发记录](74-devlog-f9.10-goal-confirm.md)。

2026-10-08：分支 `fix/bug-005-unknown-tool` 修复 BUG-005：未注册名字不再被归为权限拒绝。去掉提示词规则 2 后真实复验 5 轮 40 回合全部通过，3 次残缺工具名均在同回合恢复；规则 2 作为冗余防线保留。详见 [76：修复笔记](76-bugfix-bug-005-unknown-tool.md)。

2026-10-09：BUG-006 完成根因定位（仅排查，未修复）：残缺名由模型在 `write_` 后生成换行产生，vLLM tool parser 不校验函数名、原样返回，适配层未参与；温度 0 仍稳定复现，将工具名改为 `create_roadmap` 后对照实验消除。详见 [77：排查笔记](77-bugfix-bug-006-malformed-tool-name.md)。

2026-10-09：分支 `fix/bug-006-roadmap-rename` 将 `write_roadmap` 改名为 `create_roadmap`。受控对照中残缺名从 6/6 降到 0/6；全流程 5 轮 goal 加 1 轮 longterm 仅出现 1 次 `create_` 残缺名，且同回合恢复。BUG-006 按“模型行为 + 明确恢复策略”关闭。复验中新发现 BUG-007。

2026-10-11：PR #43（F10.1a）的 CI 前两次运行中，shell 取消测试挂起至 5 秒超时，登记为 BUG-008。诊断 PR #44、#45 在 CI 上共跑约 6 遍完整套件加 21 次专项取消，均未复现；正常取消约 0.3 秒，taskkill 每次都成功。不采用“把两个 shell 测试文件改成先后跑”：取证显示它们并发并不是触发条件。详见 [80：排查笔记](80-bugfix-bug-008-shell-cancel.md)。

2026-10-12：BUG-008 在本机冷启动全量测试中复现（15 轮 1 次），现场证实 `taskkill /T` 漏杀 pwsh 正在创建的子进程（pwsh 7 启动后 200ms 结束时 7–9 成漏杀）。修复为 shell 先把自己放进 `KILL_ON_JOB_CLOSE` 作业再执行命令，并在 `exit` 后设 1 秒排空兜底；行为变化：命令结束时其后台进程一并结束。本机冷启动多轮全量测试 0 挂起、0 残留，CI 结果见笔记。详见 [80：修复笔记](80-bugfix-bug-008-shell-cancel.md)。

2026-10-14：F5.4 真实 Electron 验收发现 BUG-010。`gpt-6-luna` 在预填目标和目标留空两条路径中均完成目标确认，但 `create_roadmap` 多次携带与 Node kind 不匹配的条件字段并被运行时拒绝；目标写入、follow、失败展示、取消和布局已通过，Roadmap 创建未通过。详见 [95：排查与修复笔记](95-bugfix-bug-010-roadmap-schema.md)。

2026-10-15：在 `fix/bug-010-roadmap-schema` 尝试把 `create_roadmap` 拆为 `work_nodes` / `checkpoints` 两个扁平数组。Qwen 对照首调合法率从 14/15 降到 12/15：模型在两个数组参数之间写出坏的 JSON。用户决定整体回退，未合入生产代码；gpt-6-luna 因额度用尽未复验。BUG-010 保持未修复，详见 [95](95-bugfix-bug-010-roadmap-schema.md)。

2026-10-15：F10.5 离线长程场景在重启前后比较节点列表时发现 BUG-011：恢复时按 `owner_id` 读取事件，导致列表顺序从创建顺序变为 UUID 顺序，数据本身不变。F10.5 测试暂时按 ID 排序后比较，详见 [99](99-bugfix-bug-011-restart-order.md)。

2026-10-15：F10.5 真实验收（`gpt-6-sol`）复现 BUG-010：用户同意规划后，Main 的 15 次 `create_roadmap` 都为 work 节点附带 `control: "checkpoint"`，全部被拒，回合在 16 步上限处 blocked，F10.5 真实验收停在规划阶段。详见 [95](95-bugfix-bug-010-roadmap-schema.md)。

2026-10-15：分支 `fix/bug-011-restart-order` 修复 BUG-011：事件历史统一按每个 owner 首条事件的 rowid 排列、owner 内按 `seq` 回放，Node 与 Session 列表重启前后保持创建顺序；资源事件以 Project 为 owner，经核实本来就稳定。新增存储层与 NodeStore 重启顺序回归测试，F10.5 恢复严格比较；本机 typecheck 与 667 项测试通过。详见 [99](99-bugfix-bug-011-restart-order.md)。

2026-10-15：分支 `fix/bug-010-remove-control-node` 按用户决定删除控制节点（start / end / checkpoint）：每个 Roadmap Node 都是带目标与完成标准的工作节点，`create_roadmap` / `modify_roadmap` 只接受这一种字段全部必填的形状，`NodeV1` 去掉 `kind` / `controlPurpose`；旧数据库中的控制节点在恢复时丢弃并把前后节点直接相连。离线验证通过，真实模型（Qwen 基线、gpt-6-luna、gpt-6-sol）尚未复验，因此保持未勾选。详见 [95](95-bugfix-bug-010-roadmap-schema.md)。

2026-10-15：BUG-010 真实模型复验（云端容器）：gpt-6-luna `scripts/goal.ts` 5 个场景全部通过，3 次 `create_roadmap` 首调均合法；gpt-6-sol 在 F10.5 场景中首次 `create_roadmap` 即成功。F10.5 后续回合因 Node 拒绝提交未满足标准的作业而中断，与本 Bug 无关。Qwen 对照与 F5.4 Electron 真实验收仍待本机完成，保持未勾选。详见 [95](95-bugfix-bug-010-roadmap-schema.md)。

2026-10-15：BUG-010 同根因扩展到 `modify_roadmap`：该工具用 `action` 承载 6 个动作并公布扁平 Schema，非当前动作的字段只在运行时拒绝；gpt-6-sol 在 F10.5 第 6 回合为 `edit_node` 填满所有字段的占位值，连续 13 次被拒。已拆为 `add_node`、`edit_node`、`remove_node`、`set_dependency`、`reorder_nodes` 五个参数全部必填的工具；复验中 sol 首次 `edit_node` 即成功。同时修正 Node 拒绝 Human 明确提交请求的问题。仍待本机 Qwen 对照与 F5.4 Electron 验收，保持未勾选。详见 [95](95-bugfix-bug-010-roadmap-schema.md)。

2026-10-19：F13.1a 代码 head `c345950` 的 CI 851 项通过后，仅文档收尾的 `333f094` 在 CI 39270330070 出现两项超时，登记 BUG-021、BUG-022。BUG-021 定位为默认 `completed` mock 只排一个响应，第二个 Turn 耗尽脚本并进入约 15 秒重试退避，且原测试未断言续接 Turn 成功；BUG-022 定位为重的进程内 evidence 测试沿用默认 5 秒预算。二者均与 BUG-020 无关。修复仅改测试夹具、断言与单项预算，本机完整 851 项通过；随后代码 head `5858f28` 的 CI 39274751429 为 851 项全部通过，两项关闭。详见 [131](131-devlog-f13-1a-ci-timeouts.md)、[132](132-bugfix-bug-021-022-ci-timeouts.md)。

2026-10-26：按方案 A 修复 BUG-035 的验收来源契约。确认失败点是验收脚本而非产品内核：判据要求“至少两份真实 fetch”，检查却要求 `source_ids` 全部对应当回合 fetch，且任务还鼓励搜索补充。现改为直读由成功 fetch 轨迹证明，`source_ids` 只要求包含必读来源并对每项可追溯，拒绝本回合未出现的 ID；同步明确任务说明并补三项回归。代码与回归已过类型检查、专项及完整本地 1056 项，CI run `40334741718` 通过，真实复验见下条。详见 [163](163-bugfix-bug-035-node-source-evidence.md)。

2026-10-26：BUG-035 修复后的第四轮真实完整任务通过。现场 `%TEMP%/navo-f136-real-R8uzdx`，282093ms，`outcome=passed`；生成 22 次（图谱 5）、Embedding 7 次全部 HTTP 200。Main 确认 / 规划、Node A 三份原文、Review A、同库重开、Node B、最终 Review B 全部通过，两 Node `lastReview=complete`，`unrecovered=0`。Node B 的 `source_ids` 仅列本回合实际 fetch 的 comparison 与 constraints，来源声明与轨迹一致。BUG-031、BUG-033、BUG-034、BUG-035 的完整关闭条件均满足并关闭；F13.6 后端完整链路通过，父项仍待正式 Renderer 验收，见 [160](160-devlog-f13-6-openrouter-acceptance.md)、[163](163-bugfix-bug-035-node-source-evidence.md)。PR #105 已 squash 合入 master（`9f3514e`），最终 head `9bb94a4` 的 CI run `40337394723` 通过。

2026-10-26 合并授权：用户明确允许 PR #100 仅合并离线验收测试、脚本与失败记录；F13.6 保持进行中，BUG-031 / BUG-032 保持未勾选。本次不重跑真实模型，不把 OpenRouter 检索通过视为原 Qwen 端点恢复或完整任务通过，详见 [156](156-devlog-f13-6-backend-acceptance.md)。

## 修复记录规则

首次修复或进一步实质排查时创建下一可用编号的 `NN-bugfix-bug-NNN-<短名>.md`，并在上表与索引建立链接；同一问题追加至已有笔记。每项写清复现、根因证据、改动、实际验证、剩余边界和 PR/提交。完成并通过该项关闭条件后才将对应任务改为 `[x]`。

已按 BUG-004 → BUG-001/002 → BUG-003 顺序处理。剩余 BUG-002：2026-10-07 用户决定保持未关闭，等待复现后依证据定性。

## 已识别但不列为已确认 Bug 的边界

- `synthesis` 是测试目标为“综合结论”的普通工作节点，不是特殊 Agent 类型。
- Resource ACL 控制已发布资源的读取；Project Workspace 是共享文件空间。能从用户 Workspace 重新发布文件不直接证明 ACL 被绕过，也不据此擅自增加节点文件白名单。
- “每回合不得发生任何工具错误”是当前真实验收脚本的严格判据，不等同于运行时不允许模型恢复；其业务适用性在 BUG-002 中一起明确。
