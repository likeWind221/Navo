# 76：F9.10 项目目标确认与规划前置

## 做了什么

- 共享契约（直接改 v1）：`ProjectCreateInput.goal` 与 `ProjectSummaryV1.goal` 改为 `string | null`。`goal` 键必须存在；值为 `null` 表示“目标待确定”；非 null 时仍要求非空白且不超过 `PROJECT_GOAL_MAX_CHARS`（8000）。没有新增其他方法或字段。
- Project 领域：`project-created.goal` 可为 null。新增事件 `project-goal-set { goal }`，以及 `ProjectStore.setGoal`：拒绝空白或超长目标（`invalid-goal`），拒绝已归档 Project（`project-unavailable`）。成功后 revision 加 1，并发出 `project/changed`，所以 follow 流会推送新快照。投影器可从事件历史重建目标，并在回放时再次校验目标长度和 Project 状态。
- Roadmap 领域：`RoadmapStore.create` 在 Project 目标为 null 时抛 `goal-required`。这是“无目标不能生成初始 Roadmap”的硬保证，绕过工具直接调用也会被拒。
- 新 Main 工具 `set_project_goal`（`src/tools/builtins/project/goal.ts`）：只允许 Main 调用，目标先 trim 再写入。当前 Project 已有 Roadmap 时拒绝，并提示目标已锁定、不要重试。工具在 `app.ts` 中注册，并加入 `MAIN_AGENT_TOOL_NAMES`。
- `write_roadmap`：在解析提案前先检查目标；目标为 null 时返回“目标未确认，先复述目标、等用户同意、用 set_project_goal 记录后再规划”。描述同步说明了这一前置条件。
- Main 系统提示词：`<project-context>` 新增 `goalStatus`（`"not yet confirmed"` / `"recorded"`），目标为空时显式输出 `"goal": null`。删除了旧指令“read_roadmap 报告没有 Roadmap 就 write_roadmap”，改为按用户确认的五种情况规定行为。用户的一次确认同时覆盖“采用目标”和“开始规划”。
- Node 上下文 `projectGoal` 的类型放宽为 `string | null`。生产环境中 Node 只在 Roadmap 之后出现，此时目标必定非空，所以没有为此新增运行时分支。
- 真实模型验收脚本 `scripts/goal.ts`：五个场景，每个场景使用独立 Project 和 Workspace；可以用参数只跑一个场景；证据写入 `NAVO_EVIDENCE_DIR`。

## 关键决策

- **直接修改 v1，不升 v2**：`project.*` 目前没有前端消费者（`frontend/**` 中未引用 `ProjectSummaryV1` / `project.create`）。前端 F5.2 是第一个消费者，并与本 Step 并行开发；升版本只会多出一套没有人用的 v1。
- **目标锁定由工具检查，“无目标不规划”由 RoadmapStore 检查**：Roadmap 依赖 Project，而 ProjectStore 不知道 Roadmap 的存在，所以锁定判断放在唯一的写入方 `set_project_goal` 中。Host 不提供设置目标的 RPC，因此这就是锁定的唯一入口。以后若开放 Human 改目标，需要把锁定判断移到一个同时依赖两个 Store 的协调层。
- **目标锁定的层级（审阅后补记，代码不改）**：
  - **现状**：“Roadmap 生成后锁定目标”的判断写在 `set_project_goal` 工具里（`src/tools/builtins/project/goal.ts`，执行时先查 `ctx.roadmaps.get(projectId)`）。`ProjectStore.setGoal` 本身不检查 Roadmap。
  - **为何不放进 Store**：RoadmapStore 已经依赖 ProjectStore（`static inject = ["projects", "nodes"]`，创建时读取 Project 状态和目标）。如果 ProjectStore 反过来查询 Roadmap，就会形成 Project ↔ Roadmap 的循环依赖，也会让 Project 领域知道它的下游。
  - **为何当前安全**：`set_project_goal` 是改目标的唯一入口。Host 没有设置目标的 RPC，Node 也没有这个工具，其他生产代码不会调用 `setGoal`。工具执行是同步的，检查 Roadmap 与写入目标之间没有 await，不存在并发窗口。
  - **后续**：做“Roadmap 后修改目标并重规划”时，需要新增一个同时依赖 ProjectStore 和 RoadmapStore 的协调服务，由它统一负责改目标、锁定判断和重规划；工具和以后的 Human RPC 都只调用这个服务。
- **领域常量重复一次**：`src/project/model.ts` 与 `rpc/project.ts` 各定义一次 `PROJECT_GOAL_MAX_CHARS = 8000`。`rpc` 是独立包，`src` 领域层也从不依赖 `rpc`，所以两边各守自己的边界。
- **“一律再确认”只写在提示词里，工具不检查回合来源**：Main 的回合只能由 Human 通过 `project.turn.v1` 发起，所以不需要像 Harness 那样做 direct-human 鉴权。“用户已同意”属于语义判断，系统无法硬性校验，只能由提示词约束，并靠真实模型验证。
- **一次确认可以连续执行写目标和规划**：提示词要求同意后先调用 `set_project_goal`（目标不同或尚未记录时），再在同一回合内调用 `write_roadmap`。

### DeepSeek Harness 对照（只读，本机 `D:/Program/AgentProgram/deepseek-harness`）

- `packages/goal/tool-goal/src/index.ts`：`create_goal` 的描述允许模型“从直接的人类请求推断目标意图”，不要求用户明确说出“创建目标”。策略文字通过 `ctx.systemPrompt.section({ name: 'tool:goal' })`，由工具插件注入系统提示词。前置条件失败时抛出带 code 的 `HarnessError`（如 `GOAL_TOOL_INVALID_UPDATE`）。
- `packages/goal/tool-goal/src/authority.ts`：`requireDirectHuman` 检查当前回合里是否有 `source.kind === 'user'` 的消息，没有就拒绝状态变更。
- `packages/core/agent-loop/src/tool-calls.ts`：工具失败会写成 `isError: true` 的 tool result 返回给模型，回合继续，由模型自行修正。
- 采用：工具前置条件失败时返回 `ToolExecutionError`，附带面向模型、可执行的下一步说明（与 Harness 的 isError 结果相同，模型在同一回合内修正）。目标由模型从人类请求中提取。
- 不采用：（1）不使用系统提示词分段注册机制。Navo 的 Main 提示词由 `profile.ts` 统一组装，规则直接写在其中。（2）不实现 `requireDirectHuman`：Main 回合只能由 Human 发起，不存在自动续跑的回合。（3）不采用 Harness“推断出意图就直接创建目标”的做法，F9.10 要求先复述目标并取得用户同意。（4）不提供 get/update/pause/complete 等目标生命周期，本 Step 只做“设置一次，Roadmap 后锁定”。

## 坑与发现

- 新增 Main 工具后，所有直接装配 Main 的测试 helper 都要注册 `SetProjectGoalTool`：AgentRuntime 遇到未注册的 `toolNames` 时会让回合失败。
- 真实模型（`qwen3.8-27b`，开启 thinking，内网默认端点）结果见下表，两轮共 16 个回合全部符合预期。
- 第 1 轮“提取目标”场景的第 2 回合里，模型输出了一个格式错误的工具名（`write_\n<parameter=reason`）。系统把它当作工具失败返回给模型，模型随后正确调用了 `write_roadmap`，属于模型格式抖动，与本 Step 无关。
- 第 1 轮“提取目标”场景的第 1 回合，模型同时提出了澄清问题和目标草案，并等待确认，没有提前写目标或规划，符合情况 3。
- 第 2 轮“提取目标”场景：第 1 回合的目标草案附带三个范围问题，用户只回复“对，就按这个目标”。模型写入的目标把它自己建议的范围倾向（以 Agent 运行时记忆为主线，聚焦 2023–2025）也并入了，文字与草案不完全一致。这仍在“用户同意”的语义范围内，但说明写入的目标可能与复述原文有差异；系统无法硬性校验，后续可以考虑把写入的目标回显给用户。
- 第 2 轮“情况 1”第 2 回合中 `write_roadmap` 被调用两次：第一次提案校验失败，第二次成功。“情况 2”第 2 回合再次出现了格式错误的工具名，随后恢复。
- `web_search` 在脚本中报告服务不可用：`createApp` 没有注册搜索 adapter，与本 Step 无关。
- `scripts/longterm.ts` 已在 PR 审阅后适配，见下方“审阅后追加”。离线的 `tests/integration/longterm` 使用 Mock 模型，不受影响。
- `src/tools/builtins/roadmap/write-roadmap.ts` 原有 334 行，本次增至 342 行。文件仍只包含单个工具的 schema、提案解析和错误映射，变化原因单一，暂不拆分。

### 真实模型五场景结果

运行命令为 `npx tsx scripts/goal.ts`，2026-10-08 连续跑了两轮，两轮的 `failed` 均为 `[]`。每个场景按预期断言 Project 目标、revision 和是否已有 Roadmap；回复文本由人工审阅。下表行为描述取自第 1 轮，第 2 轮结论相同。

| 场景 | 预填目标 | 用户输入 → Main 行为 | 第 1 轮 | 第 2 轮 |
|---|---|---|---|---|
| 打招呼 | 无 | “你好！今天过得怎么样？” → 正常寒暄，提示可以一起定目标；无工具调用，无目标，无 Roadmap | 通过 | 通过 |
| 情况 1 预填目标执行规划 | RAG 评测方案 | “执行规划” → 只调用 read_roadmap，复述预填目标并问“是否以该目标开始规划”；“同意…” → 直接 write_roadmap（目标未改，revision 1，7 个节点） | 通过 | 通过 |
| 情况 2 意图冲突 | RAG 评测方案 | 向量库选型需求 → 用表格列出差异，给出“合并版/替换版”两个修订目标并请求确认；“确认…” → set_project_goal（revision 2）后 write_roadmap（8 个节点） | 通过 | 通过 |
| 情况 3 无预填提取 | 无 | 综述需求 → 提出澄清问题和目标草案并请求确认（未写入）；“对，就按这个目标…” → set_project_goal 后 write_roadmap（7 个节点） | 通过 | 通过 |
| 意图含糊 | 无 | “帮我搞点东西吧” → 只追问方向、问题和范围，不提议目标；无工具调用 | 通过 | 通过 |

## 审阅后追加（PR #38 审阅意见）

### 改动

- **长程脚本适配**：`scripts/longterm.ts` 把原 `1-plan` 拆成两个回合。
  - `1a-confirm`：发送原规划请求原文，断言回合结束后没有 Roadmap、没有节点、目标未变。
  - `1b-plan`：用户明确同意后，附上同一请求再执行。断言保持原样，另加一条“目标未变”。
  - 后续 2–9 的 label、断言和依赖都没有改。Human 回合数从 9 变为 10，但 `sessions === 4` 的断言不受影响。
- **收紧目标写入**（`src/project/profile.ts`）：
  - 提出目标时，要把开放问题与目标分开写，目标不得预设这些问题的答案。
  - 写入的目标可以比复述更简洁，但不得加入用户未明确确认的范围取舍、假设、默认值或开放问题的答案；用户没回答的问题和 Main 自己的倾向不写进目标，或者先追问再写。
  - `set_project_goal` 成功后，必须在当次回复中以“Recorded goal:”（按用户语言）原文回显已记录的目标。
  - `set_project_goal` 的工具描述同步写入这两条约束。
- **两条因真实运行暴露问题而新增的提示词规则**：
  1. “一个本身要求规划、建节点或持久化计划的请求，无论多详细或紧急，都不算同意。”起因：第一次真实重跑 longterm 时，`1a-confirm` 回合直接调用了 `write_roadmap`（详见下文）。
  2. “同意在整个回合内有效：工具名格式错误、工具未知或提案无效导致调用失败时，修正后重试，不要再次向用户征求同意。”起因：goal 第 5、6 轮中，格式错误的工具名触发了 ToolService 的报错 `Tool '...' is not allowed for this Turn.`，模型把它误读为“平台拦截规划”，于是停下来请求用户再确认，导致规划没有落盘。
- **验收脚本加强**：`scripts/goal.ts` 情况 3 的第 1 句改为同时要求“目标草案 + 不确定的范围问题”，确保触发“草案附带开放问题、用户只回一句‘对，就按这个目标’”的情形。每个回合额外输出三项：
  - `goalSet`：本回合 `set_project_goal` 是否成功；
  - `echoed`：回复在去掉 Markdown 符号与空白后是否包含已记录目标原文；成功写入目标时，它计入 `ok`；
  - `scopeFlags`：写入目标是否含“中文/英文/2023–2025/主线”等关键词，只作人工审阅提示，不计入 `ok`。
- **离线测试**：在 `tests/project/session.spec.ts` 中补充上述各条提示词规则的断言。

### 真实模型结果（2026-10-08，`qwen3.8-27b`，开启 thinking）

**longterm**（`npx tsx scripts/longterm.ts`）

| 运行 | 提示词版本 | 结果 | 说明 |
|---|---|---|---|
| L1 | 仅收紧目标写入 | **失败**，位置 `1a-confirm` | Main 调用 `read_roadmap` 后直接 `write_roadmap` 建了 2 个节点，触发断言“1a-confirm planned before the Human agreed”。判断为行为回归，不是断言过时：英文请求里带有 “Use tools to persist the plan” 这类强指令，Main 把它当成了同意。因此新增了上面的规则 1，脚本断言没有放宽。 |
| L2 | 加入规则 1 | **通过**，10 个回合约 684 秒 | `1a-confirm` 只调用 `read_roadmap`，复述记录的目标和拟建的两个节点后，问 “Shall I start planning…”；`1b-plan` 调用 `write_roadmap`。后续回合全部通过，最终 roadmapRevision 3，3 个节点均为 completing。 |
| L3 | 最终版（加入规则 2） | **通过**，10 个回合约 386 秒 | `1a-confirm` 只调用 `read_roadmap`；`1b-plan` 调用 `read_roadmap` 后 `write_roadmap`；模型共 31 步，最终状态与 L2 相同。 |

**五场景**（`npx tsx scripts/goal.ts`）。第 1、2 轮是收紧前的结果，见上表。

| 轮次 | 提示词版本 | failed | 说明 |
|---|---|---|---|
| 第 3 轮 | 中间版本 | 作废 | 被中止的旧进程的 tsx 子进程仍在运行，与新进程同时写同一个日志和证据目录，记录交叉污染，不计入结论。 |
| 第 5 轮 | 规则 1，无规则 2 | `["prefilled-conflict"]` | 情况 2 第 2 回合：`set_project_goal` 成功并回显目标后，遇到格式错误的工具名报错 “not allowed for this Turn”，模型称“平台拦截”，重新请用户确认，没有建 Roadmap。 |
| 第 6 轮 | 规则 1，无规则 2 | `["extract-goal"]` | 情况 3 第 2 回合出现同一现象。 |
| 第 7 轮 | 最终版 | `[]` | 情况 2、情况 3 的第 2 回合都出现了格式错误的工具名，模型在同一回合内重试成功。 |
| 第 8 轮 | 最终版 | `[]` | 同上。另外情况 2 中 `write_roadmap` 因提案校验失败重试了一次。 |

第 7、8 轮各场景的结论：

- **打招呼、意图含糊**：没有调用任何工具，没有写目标，没有建 Roadmap。
- **情况 1**：先复述目标请求确认，同意后只调用 `write_roadmap`，目标未变。
- **情况 2**：列出差异并给出修订目标；确认后 `set_project_goal`（revision 2），回显目标，再建 Roadmap。

**情况 3：写入目标与复述原文对照（最终版）**

| 轮次 | 第 1 回合复述的草案（摘要） | 写入的目标 | 是否回显 | 是否含未确认的范围取舍 |
|---|---|---|---|---|
| 第 7 轮 | “撰写一份关于 LLM Agent 长期记忆机制的综述，系统覆盖主流方法（记忆构建、存储、检索、更新/遗忘等）与评测基准（benchmark 体系），产出结构化的综述文稿。”另附 5 个范围问题（RAG 边界、时间范围、基准范围、语言篇幅、深度） | 与草案相同，只删去“（benchmark 体系）”，更简洁 | 是，“Recorded goal:” 后原文回显 | 否，`scopeFlags` 为空。回复中明确说明“范围问题你没有逐条回答，因此我没有把它们写进目标”，并把它们放进“范围与大纲确认”检查点节点 |
| 第 8 轮 | “撰写一份……综述，系统梳理主流长期记忆方法（记忆架构与存储形式、写入/检索/整合/遗忘等记忆操作、代表性开源框架）与主流评测基准和数据集，产出一份带完整参考文献的成文文档。”另附 6 个范围问题 | 与草案逐字一致 | 是 | 否，`scopeFlags` 为空。未回答的 6 个问题列为“仍未回答”，没有写进目标 |

对比：第 2 轮（收紧前）写入的目标并入了 Main 自己建议的“以 Agent 运行时记忆为主线、聚焦 2023–2025”，见上文。最终版在两轮中都没有再出现这种情况。第 5、6 轮情况 3 的写入目标同样等于草案，未带未确认取舍（第 6 轮回显正确，但规划因上述误读而没有落盘）。

### 仍存在的边界

- 提示词行为只是抽样验证（最终版五场景 2 轮、longterm 1 轮），不是确定性保证。
- `qwen3.8-27b` 经常输出 `write_
<parameter=...` 这种格式错误的工具名（最终版两轮共出现 4 次），这是模型或适配层的工具调用格式问题，本 Step 只靠提示词让模型重试。ToolService 对未知工具的报错是 “not allowed for this Turn”，容易被误读为权限拦截；是否把它改成 “unknown tool” 属于内核改动，不在本 Step 处理。

## 下一步

- 由主规划在 `_docs/index.md` 登记本记录，并同步 `frontend-plan.md` 中 F5.2 的后端依赖状态。
- 后续 Step：Roadmap 生成后修改目标，以及据此重规划（涉及把锁定判断移到协调层）。
- 可考虑把 ToolService 对未知工具的报错文案和权限拒绝区分开，并排查 qwen 适配层为何产生格式错误的工具名。
- 进入 F10.0 持久化与验证设计收口；`project-goal-set` 事件需要纳入持久化范围。
