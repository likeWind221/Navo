# F12.5 主动压缩命令 `/compact`

> 日期：2026-10-17  
> 状态：✅ 已通过本机完整验证并合入 master；PR [#77](https://github.com/likeWind221/Navo/pull/77) 已 squash 合并，合并提交 3c464f5。Electron 点击级验收未执行，F12.5 不新增 UI。
> 基线：master a911f4b7b4e5f32e8c672072954f40c39417c2b1（F12.4 已合入）。  
> 范围：在现有 Session Compaction 基础上增加 Human 主动压缩入口；不重复实现摘要算法，不开发压缩 UI。

## 1. 目标与边界

F12.1–F12.4 已建立 Context Meter、压力触发压缩、摘要检查点、provider 超窗恢复和重启对账。F12.5 增加 Human 可以提前触发压缩的能力：

- 命令：`/compact`，无参数版本；
- 使用已有 `session.command.v1` 与 CommandService，不新增专用 RPC；
- 主动压缩与 pressure / overflow 共用同一套选区、摘要、检查点安装、历史回放和恢复逻辑；
- 在上下文尚未达到自动阈值时也可以主动压缩；
- 无有效选区、无可用预算或压缩收益不足时安全退出，不改写现有历史；
- 主动压缩不伪造 Agent Turn，也不将 Session 状态临时改成 Node working。

本阶段以 Host / Core 命令能力为主。若现有桌面命令输入链路已经支持 `/compact`，直接复用；不在本阶段开发新的命令输入 UI。完成后 F12.6 负责公共查询/订阅契约，F12.7 负责长程验收。

## 2. 当前代码基础与缺口

已存在且应复用的模块：

- `src/command/service.ts`：命令注册、参数校验、命令生命周期事件与 queued 执行模式；
- `rpc/command.ts`、`src/host/command.ts`、Electron Agent Bridge：已有命令传输链路；
- `src/context/compaction/compact.ts`：选区、摘要、收益检查、checkpoint 安装及 compaction 事务；
- `src/context/compaction/selector.ts`、`src/context/compaction/summarizer.ts`：安全选区与摘要生成；
- `src/session/types.ts`、`src/session/history.ts`：压缩事件结构与历史校验；
- `src/storage/interruption.ts`：启动时将未闭合压缩事务补记为 `interrupted`。

需要补齐的核心能力：

1. `compactSession()` 目前面向 Turn 内调用，`turnId` / `stepId` 及事件校验假设压缩属于某个 Turn。
2. `CommandService` 只拿到 `sessionId` 和命令参数，不天然持有当前 Session 的 model、system prompt 与工具配置。
3. Main、Node 和普通 Agent Session 的执行上下文来源不同，主动压缩必须使用正确的当前上下文，不能复制一套过期或不完整的请求构建逻辑。
4. 主动压缩必须与同 Session 的 Turn 串行，并纳入现有重启事务对账。

## 3. 命令行为契约

### 3.1 输入与调用

- 注册命令名 `compact`；`/` 前缀由现有桌面命令输入链路处理，CommandService 接收 `name: "compact"`。
- V1 不接受参数；非空参数返回 `invalid-args`。
- 使用现有 `session.command.v1`，通过 `CommandEvent` 回报开始、完成、失败与取消。
- 命令执行模式为 `queued`，复用 AgentRuntime 的 Session 串行队列；不能与同 Session 的 Turn 并发修改 history/surface。

### 3.2 执行流程

~~~text
Human 输入 /compact
        |
        v
session.command.v1 -> CommandService (queued)
        |
        v
解析 Session 当前执行上下文
(model / system prompt / tool names / request config)
        |
        v
读取当前 surface + Context Meter
        |
        v
检查预算、可压缩前缀与保留尾部
        |
        +---- 无安全选区 / 无可用预算 / 收益不足
        |                    |
        |                    v
        |              不修改 history
        |              返回可理解的 no-op 结果
        |
        v
compactSession(trigger = manual)
        |
        v
started -> checkpoint replace -> ended
        |
        v
返回压缩前后 token 估计与释放量
~~~

### 3.3 压缩策略

- `trigger` 新增 `manual`。
- Manual 模式不要求当前压力超过阈值；触发条件是 Human 显式请求。
- 仍须使用当前 Session 的模型预算和 `selectCompactablePrefix`，保留近期尾部，不拆分 tool call / result 配对，并遵守摘要请求输入预算。
- 不使用 overflow 的“尽可能压到最大”的选区策略；manual 默认沿用普通压缩的 retain 规则。
- 压缩前后使用同一 Context Meter 口径计算 `beforeTokens` / `afterTokens`，命令结果报告 `reclaimedTokens = max(0, beforeTokens - afterTokens)`。这些数值是测量值/估计值，不应宣称为 tokenizer 精确值。
- 若无足够的历史可压缩、预算不可用、摘要失败或收益不足，保留原 surface。无选区 / 无进展应作为可理解的 no-op 命令结果，而不是伪装成压缩成功。
- 容量与预算均不可用时，不猜测模型窗口，也不强制替换历史；返回明确原因。已有 `autoCompactLimit` 可用时按当前预算逻辑判断是否可执行。

### 3.4 Session 执行上下文

必须复用项目已有的权威上下文构建方式，不允许手工拼一份近似 prompt：

- **Main Session**：使用当前 Project 状态生成的 Main profile、对应模型配置与工具白名单。
- **Node Session**：使用当前 Node / Project 状态与 `NodeTurnContextBuilder` / Node profile；读取上下文不得为了压缩而调用 `beginWork()`、修改 Node 状态或消费一个 Turn。
- **普通 Agent Session**：使用 Host 为 `agent.turn.v1` 配置的默认 model、system prompt 与工具白名单。
- 建议新增窄接口 `SessionCompactionContextResolver`（名称可按仓库风格调整），统一解析 `sessionId -> { model, systemPrompt, toolNames }`；让 Main / Node 的 profile 仍由各自领域服务拥有，Host 提供普通 Session 的默认配置。
- 请求测量应复用 Agent 的请求构建逻辑或将其提取为共享纯函数；不得从旧 `llm-requested` 事件直接恢复过期的 Project system prompt 作为常规方案。若当前 Session 无法安全解析配置，应失败关闭并说明原因。

### 3.5 命令输出

- 成功：包含压缩前后 token 测量、释放量及使用的模型（如公共命令摘要长度允许）。
- 无进展：正常完成命令事件，但明确说明“未执行压缩”及原因，不写入压缩事务。
- 失败：走现有 `command-failed` 与 `commandFailure()` 错误映射。
- 取消：传播命令的 AbortSignal；若事务已开始，写入 `compaction-ended: cancelled`，不安装未完成摘要。
- 命令事件本身仍由 CommandService 生成，不把压缩日志事件伪装成聊天消息。

## 4. 事件与重启恢复契约

主动压缩不属于 Agent Turn，因此不创建虚假的 `turn-started` / `turn-ended` 记录。以 `compactionId` 作为压缩事务身份。

### 4.1 事件结构调整

- `compaction-started.data.trigger` 扩展为 `pressure | overflow | manual`。
- `compaction-started.data.turnId` 改为可选：`pressure` / `overflow` 必须带 `turnId`；`manual` 必须不带 `turnId`。
- `compaction-checkpoint.data.turnId` 与 `compaction-ended.data.turnId` 改为可选，以兼容独立 Session 压缩；manual 不写 `turnId`。
- `compactionId`、选区边界、摘要版本、结束状态及失败详情继续严格校验。既有 pressure / overflow 日志格式不变。
- `CompactSessionInput` 应允许不提供 Turn 标识；若 `stepId` 只用于旧接口但核心逻辑并不使用，应一并移除或改为真正必要的可选字段，避免为 manual 合成标识。

### 4.2 写入顺序与崩溃恢复

~~~text
compaction-started (trigger=manual, no turnId)
        |
        +--> failure/cancel --> compaction-ended
        |
        +--> checkpoint replace --> compaction-ended
~~~

- 仍遵循 started → checkpoint（成功时）→ ended 的事务顺序。
- 更新 `src/session/history.ts`：pressure / overflow 的 started 仍要求 `turnId`；manual 的 started 不允许 `turnId`；checkpoint / ended 可缺少 `turnId`；旧历史继续可读。
- 更新 `src/storage/interruption.ts`：未闭合 manual 事务在重启后同样补写 `interrupted`；生成补偿事件时，若 `turnId` 缺失必须省略字段，不能写入 `turnId: undefined`，以免违反 JSON 历史校验。
- 恢复仍先补齐压缩事务，再执行既有 Turn 中断收尾。manual 不应因此合成 Turn 收尾或 Node work-ended。
- 若 checkpoint 已提交但 ended 尚未写入，重启后保留已提交 checkpoint，只补 `interrupted` 终态；不得重复应用 replace。

## 5. 推荐实现拆分

| Step | 工作内容 | 重点 |
|---|---|---|
| 1. 上下文解析 | 增加统一的 Session 压缩上下文解析接口，覆盖 Main / Node / 普通 Session | 正确模型、当前 system prompt、工具白名单；不依赖旧请求快照 |
| 2. 压缩核心解耦 | 扩展 `compactSession` 支持 `manual` 且不依赖 Turn 标识 | 复用现有 selector / summarizer / checkpoint，不复制压缩算法 |
| 3. 事件与恢复兼容 | 扩展 trigger、Turn 标识可选规则、历史校验和 interruption repair | 旧日志兼容；manual 无虚构 Turn |
| 4. 注册命令 | 注册 `compact` queued command，解析预算、调用共享压缩服务并返回结果 | 复用 `session.command.v1` 与命令事件链 |
| 5. 测试与文档 | 补充单元、集成、重启测试并更新计划 | 先离线完整验证，再进行本机桌面调用 |

## 6. 验收标准

### 功能验收

- [x] `/compact` 无参数可通过现有命令链路调用。
- [x] 阈值以下也能触发压缩；压缩成功后下一次 Agent Turn 使用新的 checkpoint surface。
- [x] Main / Node / 普通 Session 均能解析正确执行上下文；不能解析时安全失败。
- [x] 同一 Session 有活跃 Turn 时，压缩不与其并发修改 history。
- [x] no-op、摘要失败、取消、异常均不破坏现有 surface。
- [x] 主动压缩不创建虚假 Turn / Node 状态变化。

### 数据与恢复验收

- [x] manual 事件的 trigger 与可选 `turnId` 语义通过运行时校验。
- [x] 旧 pressure / overflow 历史仍可读取并可回放。
- [x] 手动压缩事务中断后，重启补写 `interrupted`，已提交 checkpoint 不重复应用。
- [x] 对普通 Session 与 Project Main / Node Session 均有测试。

### 质量门槛

- [x] 对新增/修改文件执行 typecheck、lint（若仓库配置有）及相关测试。
- [x] `pnpm typecheck`、`pnpm test` 完整通过；Windows Git Bash 如遇 `whoami.exe` PATH 问题，按 F12.4 记录将 `C:\\Windows\\System32` 放在 PATH 前再复测。
- [x] PR #77 当前 head CI 通过并已 squash 合入 master（3c464f5）。
- [x] 通过现有 Host 命令入口验证 /compact 成功与 no-op 两条路径；未启动 Electron 界面做点击级验收，该项不属于本阶段 UI 范围。
- [x] 更新 F12.5 记录、`backend-plan.md` 与文档索引；记录测试数量、提交 SHA 与剩余问题。

## 7. 不在本阶段做

- 不开发新的 slash-command UI，不新增专用 RPC。
- 不增加独立摘要模型配置、手动保留比例参数或 `/compact <target>` 参数。
- 不实现工具结果剪枝、图片 offload、RAG、跨 Session 检索或可召回压缩。
- 不改写 Context Meter、摘要算法或 overflow 恢复策略；只做支持 manual 所必需的最小解耦。
- 不把 F12.6 公共上下文查询/事件订阅或 F12.7 长程 AutoRun 验收提前混入本阶段。

## 8. 本阶段完成时需要交付

1. `/compact` 的可用实现及完整测试。
2. 事件兼容与重启恢复回归测试。
3. 本机桌面调用证据和 no-op / failure 现场。
4. 本文件状态、`backend-plan.md`、`_docs/index.md` 的同步更新。
5. PR 链接、最新 head CI 状态、完整测试数量和已知限制。

## 9. 实现记录（2026-10-17）

### 做了什么

- 新增 `SessionContextResolver`（`src/command/context.ts`）：按 Session 绑定解析执行上下文。Main 与 Node 分别由 `MainSessionService.resolveContext`、`NodeSessionService.resolveContext` 使用当前 Project / Node 状态和既有 profile 生成；普通 Session 使用 Host 注入的 `agent` 配置；无法解析时命令失败关闭。
- 从 Agent 请求链路提取 `createGenerateRequest`（`src/agent/request.ts`），让 Turn 与独立压缩共享同一套 model / system prompt / tools 与历史投影口径。
- `compactSession` 新增 `manual` trigger、可选 `turnId`，移除未使用的 `stepId`；`no-progress` 返回 `budget-disabled` 或 `no-safe-selection` 原因；manual 沿用普通保留比例，不使用 overflow 的零保留策略。
- 事件类型与历史校验：manual 的 `compaction-started` 不允许 `turnId`，pressure / overflow 仍必须带；checkpoint / ended 的 `turnId` 可选；manual 场景缺省时直接省略字段而不是写入 `undefined`。
- `src/storage/interruption.ts` 按同一规则补写未闭合 manual 事务的 `interrupted` 终态；恢复只追加 ended，不重复应用已提交 checkpoint。
- 新增 `src/command/compact.ts`，注册无参数 `compact` queued 命令，复用 CommandService、`session.command.v1` 和共享压缩核心：成功报告前后测量、释放量与模型；无选区 / 无预算 / 收益不足明确说明未执行；摘要失败走 `command-failed`；取消传播 AbortSignal。
- `src/app.ts` 装配 resolver 与命令；`src/host/main.ts` 把 `config.agent` 传入应用，保证普通 Agent Session 与 `agent.turn.v1` 使用同一配置。

### 测试结果

- `pnpm typecheck` 通过。
- `pnpm test` 在 Git Bash 中前置 `/c/Windows/System32` 后：118 个测试文件、748 项测试全部通过。
- 新增 `tests/command/compact.spec.ts`（12 项）：阈值以下成功并验证下一次 Turn 使用 checkpoint、保留近期尾部、无安全选区、容量不可用、收益不足、摘要失败、取消、同 Session Turn 排队、参数拒绝、无上下文失败、Main / Node 上下文解析、Host 命令入口成功与 no-op。
- `tests/session/history.spec.ts` 新增 manual 事务校验、Turn 标识约束与旧 pressure / overflow 兼容。
- `tests/storage/database.spec.ts` 新增 manual 未闭合事务与“checkpoint 已提交但 ended 缺失”的重启对账。
- 实现提交：`1f8e313`（`F12.5: add manual /compact command`）。
- PR：[#77](https://github.com/likeWind221/Navo/pull/77) 已 squash 合入 master，合并提交 3c464f5；当前 master head 即为 F12.5 合入后的代码基线。

### 坑与发现

- 独立命令的 Service Context 必须显式注入 `tools` 和 `llm`，否则请求构建与摘要请求会因 Cordis 注入边界失败。
- Main / Node profile 的工具白名单必须与已注册工具一致；`ToolService` 对未知白名单项显式报错，压缩因此同样失败关闭，而不是静默忽略。
- `NodeSessionService.resolveContext` 只读取 Node 快照并复用既有 `NodeTurnContextBuilder`，不调用 `beginWork()`；测试断言 Node 事件数与状态均未变化。
- 桌面入口验证：本机通过 `createSessionCommandHandler`（`session.command.v1` 的 Host 处理入口）执行了成功与 no-op 两条路径；未启动 Electron 界面做点击级验收。

### 剩余问题

- F12.6 才提供公共查询 / 订阅契约；当前压缩结果只通过 CommandEvent 摘要返回。
- Electron 点击级命令验收不在本 Step，前端无需新增命令白名单即可复用现有输入链路。
- F12.3 记录中的本机完整验证跟踪项仍在；本次已用同环境全量测试验证当前分支，但未改写其历史结论。

下一步：进入 F12.6 压缩与上下文压力公共契约，设计见 [115](115-devlog-f12-6-public-context-contract.md)。
