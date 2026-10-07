# 69：BUG-001 至 BUG-004 长程真实验收排查与修复

关联：[Bug 跟踪表](bug-plan.md)、[67：F9.8 长程验收](67-devlog-f9.8-longterm-acceptance.md)、[68：Bug 跟踪机制](68-devlog-bug-tracking.md)。分支 `fix/bug-001-004-longterm`，[Draft PR #33](https://github.com/likeWind221/Navo/pull/33)。

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
| run 7 | 同 run 6 | 9 回合全部通过，1 个已恢复工具错误 | `navo-evidence-7/01-1-plan.json`、`08-8-status.json`、`09-9-resume.json` |
| run 8 | + 名称解析与 resource_id 枚举 | 续接回合以名称 `validation.txt` 读到 validation 并给出正确结论；旧断言只比对参数中的 ID，判为失败（误报） | `navo-evidence-8/09-9-resume.json`、`failure.json` |
| run 9 | 同 run 8 | 9 回合全部通过，1 个已恢复工具错误 | `navo-evidence-9/09-9-resume.json` |
| run 10 | + 断言改为核对返回的 Resource（最终代码） | 9 回合全部通过，0 个工具错误 | `navo-evidence-10/09-9-resume.json` |
| run 11 | 最终代码 | 9 回合全部通过，0 个工具错误 | `navo-evidence-11/09-9-resume.json` |

- BUG-001 根因（已证实为模型选择问题，而非上下文缺失）：
  - run 2 `08-8-resume.json` 首个请求的系统提示 `<available-resources>` 同时列出 evidence 与 validation（`f197ae94…`，name `supplied-validation`），并包含“Turn 起点快照优先于早先陈述”的规则；模型仍声称快照中只有一个 Resource，并把名称 `independent-validation`、`supplied-validation`、`validation` 当作 `resource_id` 调用 `fetch_resource`，三次均失败。
  - run 5 `09-9-resume.json` 同样在系统提示中列出 validation（`9b343b12…`），模型未尝试读取，直接声称“只有 evidence 可见”并向 Main 索要 ID。
  - 结论：新 Resource 已送达，但位于对话最前端的系统提示被后续历史中“validation 缺失”的结论压过；另有把名称当 ID 的参数误用。只改系统提示规则时，续接回合成功率为 2/4（run 2、5 失败，run 3、4 通过）。
- BUG-002：run 2 至 run 5 中 validation 的 `register_resource` 均以 `validation.txt` 成功注册，未复现原错误；原失败的真实 path 与 errno 仍未取得，不能断言是模型路径错误还是 I/O 故障。
- BUG-003：
  - run 2、run 3 的第 3/7 回合 Main 未陈述节点状态；但 run 3 `07-7-handoff` 回答称 synthesis“可以启动”，实际仍为 locked 且本回合未读取，属于未经核实的可运行性陈述。
  - run 4 `03-3-handoff` 明确写出“本回合未重新核实节点状态”；run 4/5 的 `08-8-status` 均在本回合调用 `read_node` 后回答 `idle`，run 4 还说明之前的 locked 已过时。
- 最终代码复验：run 6、run 7 的 `09-9-resume.json` 中最后一条 user 消息均含两个文本块（人工指令 + `<resource-changes>`，列出 validation 的 id 与 name），synthesis 首次调用即以该 ID 成功 `fetch_resource`，以 125 ms / 93.5% 等数值推荐 A，并保留“小样本合成数据、生产负载未测”的限制；Session 与 Human Gate 断言全部通过。run 6 `03-3-handoff` 中 Main 先 `read_roadmap` 再陈述状态；run 7 两次交接回答未陈述节点状态。
- Resource 引用加固复验（run 8-11）：
  - 所有回合中带 `resource_id` 的调用均成功，无一失败。
  - run 8 的名称最终解析到 validation（`97cf43e5…`），回答引用 125 / 93.5。
  - run 9-11 的续接回合均直接使用 ID。
- 可恢复工具错误样本：run 4 `05-5-replan.json` 中 `edit_node` 传入 `depends_on` 被拒绝，模型改用 `connect` 成功；run 5 `01-1-plan.json` 的第一次 `write_roadmap` 失败后第二次成功。

## 修复内容

### DeepSeek Harness 参考

- `deepseek-harness/packages/fs/tool-fs/src/error.ts`：在模型边界为可恢复错误附加唯一正确的补救动作，保留机器错误码并以 `cause` 链接原始错误。采用于 BUG-002 的 path/errno 消息与 BUG-001 的“名称不是 ID”提示；未采用其 FsError 码体系，Navo 继续使用 `ResourceError` 与 `ToolExecutionError`。
- `deepseek-harness/packages/plan/plan-mode/src/index.ts`（`agent/pre-step` 中追加 narration）：模式在回合之间变化时，既更新提示分区，又在本步消息末尾追加一条说明变化的消息。采用为 Node 续接回合的 `<resource-changes>` 通知；未采用其事件日志折叠与 pending intent 机制，Navo 只在 Human 启动 Turn 时生成一次。
- 同文件第 65 行说明 Harness 刻意保持请求工具目录稳定，以避免模式切换改变工具定义。Navo 的 `resource_id` 枚举会随可见 Resource 变化，与此不同。取舍依据：Navo 的系统提示本来每个 Turn 都会重建，提示前缀缓存在 Turn 边界已经失效；枚举只在 Turn 内可见集合变化（如注册或删除 Resource）时才额外变化，成本有限。

### 代码改动

- BUG-004（证据留存）：`scripts/longterm/evidence.ts` 按回合写出请求消息（剔除 reasoning）、工具调用参数与结果、错误、节点/资源/Mailbox 状态；脚本失败时写 `failure.json`。证据目录由 `NAVO_EVIDENCE_DIR` 指定，默认系统临时目录，不写入仓库，不包含凭据。
- BUG-002（错误可诊断）：`src/resource/path.ts` 发布来源失败时按 errno 生成含 Workspace 相对 path 的消息（不含绝对路径）；`src/tools/builtins/resource/common.ts` 将其传给模型；`src/tools/service.ts` 在工具失败 `details.causes` 中记录 cause 链的 name/code。
- BUG-001（续接读取新资源）：
  - `src/node/profile.ts` 系统提示声明 Turn 起点快照优先于早先陈述；新增 `formatResourceChanges`。
  - `src/node/session.ts` 记录每个 Session 上一 Turn 可见的 Resource ID，续接 Turn 把新增可见 Resource 的 id 与 name 作为 `<resource-changes>` 文本块附在人工消息之后；首个 Turn 或无变化时不附加。该记录为进程内状态，与 Phase 9 其他内存状态一致，进程重启后首个续接 Turn 不产生通知。
  - 名称解析（`src/tools/builtins/resource/common.ts` 的 `resolveResourceRef`）：四个 Resource 工具的 `resource_id` 同时接受 ID 和唯一名称。
    - 解析只在调用方可见的 Resource 中进行：先按 ID 精确匹配，再按名称匹配（忽略首尾空白与大小写）。
    - 名称唯一时解析为对应 ID；重名时返回错误，并列出候选 ID；没有匹配时按 ID 交给领域层，报告不可用。
    - 私有、不可见的 Resource 永不参与匹配，ACL 边界不变。
    - 这一做法取代了上一版“名称当 ID 时在错误中给出 ID”的提示：名称误用这一类错误直接被消除。
  - 逐步 `resource_id` 枚举：
    - `ToolDefinition` 新增可选的 `parametersFor(sessionId)`；`ToolService.schemas` 在每次模型请求时用它生成该 Session 的参数 schema，`src/agent/request.ts` 传入 sessionId。
    - 四个 Resource 工具借助 `withVisibleResourceRefs`，把当前可见 Resource 的 ID 与唯一名称写入 `resource_id` 的 `enum`。
    - 没有可见 Resource、Session 未绑定或生成失败时，回退为静态 schema。
    - 执行期仍按静态 schema 校验，引用解析统一由 `resolveResourceRef` 负责，避免两处规则不一致。
- BUG-003（状态陈述）：`src/project/profile.ts` 规定 Main 陈述节点状态或“能否运行”前必须在本回合调用 `read_roadmap` / `read_node`，否则说明状态未核实。
- 验收口径（`scripts/longterm.ts`）：
  - 由“回合内不得有任何错误”改为“不得有未恢复错误”：工具错误之后同回合同名工具成功视为已恢复；LLM、运行时错误及未恢复的工具错误仍判失败。原始 `errors` 全量写入证据，不被隐藏。
  - 续接回合必须成功 `fetch_resource` 到 validation：按工具结果中返回的 Resource 身份判断，ID 或唯一名称都可以。
  - 新增 `8-status` 探针回合：人工确认 validation 后询问 Main，要求本回合读取状态并回答 `idle`，且不改变 Roadmap。

## 验证结果与边界

- 本机 Node v24.14.0：`pnpm typecheck` 通过；`scripts/**` 额外纳入 tsc 检查通过；`pnpm test` 78 个文件、460 项全部通过（云端曾有 5 个仅与环境相关的 shell/process 失败，本机未出现）。
- 枚举约束探针：直接向 Qwen 服务发请求，要求模型传入不在 enum 中的值。
  - `tool_choice: required` 时，参数被限制在 enum 内；
  - `tool_choice: auto`（Navo 当前的默认）时，模型同样选择了 enum 内的值；
  - 单次探针无法区分是服务端强制约束还是模型主动遵循，因此枚举视为强引导，硬约束取决于推理后端。
- 新增/扩展离线测试：
  - 缺失来源返回 path 与 ENOENT，不泄露绝对路径，随后以正确路径恢复；
  - 唯一名称可以读取，重名时报错并列出候选 ID，私有名称不会匹配；
  - 每个 Session 的 enum 只包含其可见的 ID 与唯一名称，不带 sessionId 或 Session 未绑定时没有 enum；
  - 续接 Turn 仅在新增可见 Resource 时附加 `<resource-changes>`；
  - Main / Node 提示包含新规则。
- 真实运行：
  - 续接回合在只有系统提示规则时为 2/4（run 2-5）；
  - 加入续接资源变化通知后，续接回合全部读到 validation，共 6/6（run 6-11，其中 run 8 为断言误报，行为正确）；
  - 状态探针 8/8（run 4-11）均在本回合读取后回答 `idle`。
- 各项结果：
  - BUG-001：已修复。证据确认上下文已送达，失败来自模型被历史中“缺失”的结论压过及把名称当 ID；变化通知后续接 6/6 真实成功，名称解析与枚举加固后 Resource 工具调用零失败。
  - BUG-002：可诊断性与验收口径已落地；原错误在 run 2-11 中未复现，真实 path/errno 未取得，保持未勾选，待用户决定关闭条件或等待复现。
  - BUG-003：已修复。探针 4/4 正确，交接回答不再给出与事实不符的状态。残余观察：run 6 `07-7-handoff` 称“validation 确认前 synthesis 保持 locked”，属于依赖推理，与事实一致但未在该回合读取。
  - BUG-004：已修复。run 2、run 5 的 `failure.json` 与回合文件足以区分上下文缺失、模型选择与 I/O 错误；证据中无 reasoning 与凭据。
- 边界：模型具有随机性，少量运行只能证明修复后出现失败的概率下降，不能证明不再发生；BUG-002 原错误未复现，真实 path/errno 未取得；未覆盖进程重启后的续接通知、桌面 UI 与数据库持久化。

## 后续

- BUG-002：若再次出现来源不可用，直接读取对应回合 `register_resource` 的 path 参数与 `details.causes` 中的 errno 定性；在用户决定关闭条件前保持未勾选。
- 续接资源变化记录目前在进程内，F10 持久化时随 Session 状态一起落盘恢复。
- 待办：提供 `list_resources` 工具，让模型在怀疑时可以现查（用户决定延后）。
- 待议：把 `<resource-changes>` 抽成通用 system-reminder 机制，同时为 Main 推送节点状态变化，用以加强 BUG-003；需用户确认。
- 真实验收仍为手动脚本，不进入 CI；后续可扩充为多次复跑并统计成功率。
- F9.8 是否据此改为完成由用户决定。

## 面试复盘

完整的面试可背版本（问题 → 根因 → 修复 → 结果）见 [71：长程验收四个 Bug 复盘（面试版）](71-interview-longterm-bugs.md)。

PR：[#33](https://github.com/likeWind221/Navo/pull/33)（Draft，待用户审核合并）
