# 69：BUG-001 至 BUG-004 长程真实验收排查与修复

关联：[Bug 跟踪表](bug-plan.md)、[67：F9.8 长程验收](67-devlog-f9.8-longterm-acceptance.md)、[68：Bug 跟踪机制](68-devlog-bug-tracking.md)。分支 `fix/bug-001-004-longterm`，Draft PR 见文末。

## 现象与复现

- 复现命令：`pnpm exec tsx scripts/longterm.ts`，`NAVO_EVIDENCE_DIR` 指向仓库外目录；模型 `qwen3.8-27b`（局域网 Qwen，thinking 开启，maxTokens 8192），每回合上限 16 步，关闭模型自动重试。运行环境 Windows 11、Node v24.14.0。
- 各运行证据目录保留在本机 `%TEMP%\navo-evidence-<n>`（不入库），每个人工回合写 `NN-<label>.json`，失败时写 `failure.json`。下文按目录与文件名引用。
- BUG-001：synthesis 续接回合未读取新共享的 validation，无法给出最终推荐。
- BUG-002：validation 注册 `validation.txt` 时出现 `Resource source file is unavailable`。
- BUG-003：Main 在 synthesis 实际已变化时仍报告旧状态。
- BUG-004：失败输出只有工具名与错误摘要，应用释放后无法还原现场。

## 已证实事实与根因假设

### 云端离线排查（无真实模型）

- BUG-001：离线测试证明续接 Turn 的系统提示包含新共享 Resource 的 ID 与元数据，且保留完整历史（`system,user,assistant,user`），排除“上下文传递遗漏”。
- BUG-002：旧错误把 realpath/stat 失败统一包装为 `Resource source file is unavailable.`，丢失失败 path 与 errno，无法区分模型路径错误与 I/O 故障。
- BUG-003：人工确认在 Main 对话之外发生；Main 提示中没有“陈述状态前先读取”的规则，模型只能依赖历史中的旧值。
- BUG-004：脚本仅打印摘要，未持久化请求、工具参数、结果与领域状态。

### 本机真实运行证据

| 运行 | 代码版本 | 结果 | 关键证据 |
|---|---|---|---|
| run 1 | 云端补丁 | 第 1 回合 TRANSPORT（模型服务当时不可用），非 Bug 结论 | `navo-evidence-1/01-1-plan.json`、`failure.json` |
| run 2 | 云端补丁 | 第 8 回合失败 | `navo-evidence-2/08-8-resume.json`、`failure.json` |
| run 3 | + Resource ID 提示 | 8 回合全部通过 | `navo-evidence-3/08-8-resume.json` |
| run 4 | + 状态探针回合 | 9 回合全部通过 | `navo-evidence-4/05-5-replan.json`、`08-8-status.json`、`09-9-resume.json` |
| run 5 | + Main 可运行性规则 | 第 9 回合失败 | `navo-evidence-5/09-9-resume.json`、`failure.json` |
| run 6 | + 续接资源变化通知（最终代码） | 9 回合全部通过，0 个工具错误 | `navo-evidence-6/03-3-handoff.json`、`08-8-status.json`、`09-9-resume.json` |
| run 7 | 最终代码 | 9 回合全部通过，1 个已恢复工具错误 | `navo-evidence-7/01-1-plan.json`、`08-8-status.json`、`09-9-resume.json` |

- BUG-001 根因（已证实为模型选择问题，而非上下文缺失）：
  - run 2 `08-8-resume.json` 首个请求的系统提示 `<available-resources>` 同时列出 evidence 与 validation（`f197ae94…`，name `supplied-validation`），并包含“Turn 起点快照优先于早先陈述”的规则；模型仍声称快照中只有一个 Resource，并把名称 `independent-validation`、`supplied-validation`、`validation` 当作 `resource_id` 调用 `fetch_resource`，三次均失败。
  - run 5 `09-9-resume.json` 同样在系统提示中列出 validation（`9b343b12…`），模型未尝试读取，直接声称“只有 evidence 可见”并向 Main 索要 ID。
  - 结论：新 Resource 已送达，但位于对话最前端的系统提示被后续历史中“validation 缺失”的结论压过；另有把名称当 ID 的参数误用。只改系统提示规则时，续接回合成功率为 2/4（run 2、5 失败，run 3、4 通过）。
- BUG-002：run 2 至 run 5 中 validation 的 `register_resource` 均以 `validation.txt` 成功注册，未复现原错误；原失败的真实 path 与 errno 仍未取得，不能断言是模型路径错误还是 I/O 故障。
- BUG-003：
  - run 2、run 3 的第 3/7 回合 Main 未陈述节点状态；但 run 3 `07-7-handoff` 回答称 synthesis“可以启动”，实际仍为 locked 且本回合未读取，属于未经核实的可运行性陈述。
  - run 4 `03-3-handoff` 明确写出“本回合未重新核实节点状态”；run 4/5 的 `08-8-status` 均在本回合调用 `read_node` 后回答 `idle`，run 4 还说明之前的 locked 已过时。
- 最终代码复验：run 6、run 7 的 `09-9-resume.json` 中最后一条 user 消息均含两个文本块（人工指令 + `<resource-changes>`，列出 validation 的 id 与 name），synthesis 首次调用即以该 ID 成功 `fetch_resource`，以 125 ms / 93.5% 等数值推荐 A，并保留“小样本合成数据、生产负载未测”的限制；Session 与 Human Gate 断言全部通过。run 6 `03-3-handoff` 中 Main 先 `read_roadmap` 再陈述状态；run 7 两次交接回答未陈述节点状态。
- 可恢复工具错误样本：run 4 `05-5-replan.json` 中 `edit_node` 传入 `depends_on` 被拒绝，模型改用 `connect` 成功；run 5 `01-1-plan.json` 的第一次 `write_roadmap` 失败后第二次成功。

## 修复内容

### DeepSeek Harness 参考

- `deepseek-harness/packages/fs/tool-fs/src/error.ts`：在模型边界为可恢复错误附加唯一正确的补救动作，保留机器错误码并以 `cause` 链接原始错误。采用于 BUG-002 的 path/errno 消息与 BUG-001 的“名称不是 ID”提示；未采用其 FsError 码体系，Navo 继续使用 `ResourceError` 与 `ToolExecutionError`。
- `deepseek-harness/packages/plan/plan-mode/src/index.ts`（`agent/pre-step` 中追加 narration）：模式在回合之间变化时，既更新提示分区，又在本步消息末尾追加一条说明变化的消息。采用为 Node 续接回合的 `<resource-changes>` 通知；未采用其事件日志折叠与 pending intent 机制，Navo 只在 Human 启动 Turn 时生成一次。

### 代码改动

- BUG-004（证据留存）：`scripts/longterm/evidence.ts` 按回合写出请求消息（剔除 reasoning）、工具调用参数与结果、错误、节点/资源/Mailbox 状态；脚本失败时写 `failure.json`。证据目录由 `NAVO_EVIDENCE_DIR` 指定，默认系统临时目录，不写入仓库，不包含凭据。
- BUG-002（错误可诊断）：`src/resource/path.ts` 发布来源失败时按 errno 生成含 Workspace 相对 path 的消息（不含绝对路径）；`src/tools/builtins/resource/common.ts` 将其传给模型；`src/tools/service.ts` 在工具失败 `details.causes` 中记录 cause 链的 name/code。
- BUG-001（续接读取新资源）：
  - `src/node/profile.ts` 系统提示声明 Turn 起点快照优先于早先陈述；新增 `formatResourceChanges`。
  - `src/node/session.ts` 记录每个 Session 上一 Turn 可见的 Resource ID，续接 Turn 把新增可见 Resource 的 id 与 name 作为 `<resource-changes>` 文本块附在人工消息之后；首个 Turn 或无变化时不附加。该记录为进程内状态，与 Phase 9 其他内存状态一致，进程重启后首个续接 Turn 不产生通知。
  - `src/tools/builtins/resource/common.ts` 四个 Resource 工具的 `resource_id` 参数统一说明“必须是 ID，不是名称”；`fetch.ts` 在 ID 不存在但调用方可见 Resource 中有同名者时，错误返回对应 ID，不可见 Resource 仍只返回通用不可用消息。
- BUG-003（状态陈述）：`src/project/profile.ts` 规定 Main 陈述节点状态或“能否运行”前必须在本回合调用 `read_roadmap` / `read_node`，否则说明状态未核实。
- 验收口径（`scripts/longterm.ts`）：
  - 由“回合内不得有任何错误”改为“不得有未恢复错误”：工具错误之后同回合同名工具成功视为已恢复；LLM、运行时错误及未恢复的工具错误仍判失败。原始 `errors` 全量写入证据，不被隐藏。
  - 续接回合必须以 validation 的 ID 成功 `fetch_resource`。
  - 新增 `8-status` 探针回合：人工确认 validation 后询问 Main，要求本回合读取状态并回答 `idle`，且不改变 Roadmap。

## 验证结果与边界

- 本机 Node v24.14.0：`pnpm typecheck` 通过；`scripts/**` 额外纳入 tsc 检查通过；`pnpm test` 78 个文件、459 项全部通过（云端曾有 5 个仅与环境相关的 shell/process 失败，本机未出现）。
- 新增/扩展离线测试：缺失来源返回 path 与 ENOENT 且不泄露绝对路径、随后以正确路径恢复；名称当 ID 时返回可见 Resource 的 ID 且不暴露私有 Resource；续接 Turn 仅在新增可见 Resource 时附加 `<resource-changes>`；Main / Node 提示包含新规则。
- 真实运行：续接回合在只有系统提示规则时为 2/4（run 2-5），加入续接资源变化通知后为 2/2（run 6、7）；状态探针 4/4（run 4-7）均在本回合读取后回答 `idle`。
- 各项结果：
  - BUG-001：已修复。证据确认上下文已送达，失败来自模型被历史中“缺失”的结论压过及把名称当 ID；最终代码 2/2 真实通过。
  - BUG-002：可诊断性与验收口径已落地；原错误在 run 2-7 中未复现，真实 path/errno 未取得，保持未勾选，待用户决定关闭条件或等待复现。
  - BUG-003：已修复。探针 4/4 正确，交接回答不再给出与事实不符的状态。残余观察：run 6 `07-7-handoff` 称“validation 确认前 synthesis 保持 locked”，属于依赖推理，与事实一致但未在该回合读取。
  - BUG-004：已修复。run 2、run 5 的 `failure.json` 与回合文件足以区分上下文缺失、模型选择与 I/O 错误；证据中无 reasoning 与凭据。
- 边界：模型具有随机性，少量运行只能证明修复后出现失败的概率下降，不能证明不再发生；BUG-002 原错误未复现，真实 path/errno 未取得；未覆盖进程重启后的续接通知、桌面 UI 与数据库持久化。

## 后续

- BUG-002：若再次出现来源不可用，直接读取对应回合 `register_resource` 的 path 参数与 `details.causes` 中的 errno 定性；在用户决定关闭条件前保持未勾选。
- 续接资源变化记录目前在进程内，F10 持久化时随 Session 状态一起落盘恢复。
- 真实验收仍为手动脚本，不进入 CI；后续可扩充为多次复跑并统计成功率。
- F9.8 是否据此改为完成由用户决定。

## 面试复盘

- 背景：Navo 是 Human-in-the-loop 长程 Agent 框架。Main 规划 Roadmap，多个 Node Agent 各执行一个节点，通过带 ACL 的 Resource 与 Mailbox 交接，节点启动与完成都由人确认。验收用真实模型跑 evidence → synthesis 阻塞 → Main 重规划加入 validation → synthesis 原 Session 续接得出结论的 9 个人工回合。
- BUG-004（先补可观测性）：失败只剩工具名与摘要，进程退出即丢现场，甚至导致对 BUG-002 的错误归因。改为每回合落盘模型请求、工具参数与结果、领域状态，失败写 `failure.json`。要点：没有证据就没有根因，BUG-001 正是靠这些证据才查清。
- BUG-001（区分“系统没给”与“模型没用”）：离线测试先证明新资源已进入续接回合提示，真实证据再显示两种失败：把名称当 ID，以及沿用历史中“缺失”的结论。根因是长对话中的陈旧结论惯性，新事实只在对话最前端的系统提示里。借鉴 Harness plan-mode 的 narration，把“自上回合新增的可见资源”放在最新人工消息旁；借鉴 Harness tool-fs 的错误补救，参数说明强调 ID、名称误用时返回正确 ID。成功率从 2/4 到 2/2。要点：优先调整信息位置与工具语义，提示词规则只作补充。
- BUG-002（验收口径匹配真实场景）：旧错误丢失 path 与 errno，无法区分模型路径错误与 I/O 故障。补齐诊断信息，并把验收从“零报错”改为“不得有未恢复错误”，原始错误仍全量留存。原错误未复现，因此不宣称已修复。要点：Agent 工具报错是常态，考核恢复能力与结果正确性，同时防止掩盖真问题。
- BUG-003（权威状态在 Store，不在对话）：人工确认发生在 Main 对话之外，Main 只能复述历史旧值。规定陈述状态或可运行性前必须本回合读取，否则声明未核实，并加入状态转换探针验证。要点：与分布式系统“读最新版本、不信缓存”同理。
- 方法论：可观测性 → 离线排除工程原因 → 真实证据定位模型行为 → 结构性修复 → 多次真实复跑并如实记录成功率与边界。

PR：PR_LINK
