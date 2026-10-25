# 152：F13.4a 统一 Turn Context

日期：2026-10-25。范围：仅后端统一上下文构建与请求注入。状态：✅ 已完成。PR #97 的代码 head CI 通过，已 squash 合入 master（5bdf3f3）。

## 做了什么

- `src/context/turn.ts` 定义 `TurnContextSnapshot`、按 kind 区分的 section、同步 Provider 与 Builder。每次 build 重读数据，只在当前 Builder 内保留去重 Reminder；每个 Turn 创建独立 Builder。Working Board 目前只有 section 扩展位置，没有 Store 或实现。
- `src/project/context.ts` 聚合当前任务状态、临时 Resource 目录与已有 Reminder。每次读取 Session 的可信 Binding，检查 Project 可用状态；Main 获取本 Project Goal / 状态与 Node 状态摘要；Node 复用 `NodeTurnContextBuilder` 获取自己的 Objective / 标准 / 状态。不会读取其他 Node Session。
- `src/resource/context.ts` 是本阶段兼容 Provider 的元数据读取边界：先执行已有 `listVisible` ACL，再输出 id、名称、描述、类型、revision、是否归当前 Agent 所有。Node Builder 与 Main 共用它，不读取正文或路径。F13.4c 目录工具可用后退出自动目录注入。
- Main / Node Profile 不再接受动态数据参数。Main 普通 / review 和 Node 是否开放 read 仍是固定能力预设；Goal、Node 定义、状态、目录与提醒均由独立数据消息提供。Main review checklist 同样只在当前 Turn 临时提供。
- `src/agent/request.ts` 在每次模型尝试、压缩后和超窗恢复后调用 `buildTurnContext`。唯一 AgentRuntime 只传递通用 callback，不认识 Project / Node 业务。
- `/compact` 与 Session Context Meter 通过已有 resolver 获取同一构建入口；预览不更新已观察事实，也不启动 Turn。

## 关键决策

### 请求格式与日志

应用内 `GenerateRequest.messages` 保留固定 system 与 Session 投影，新增独立可选 `turnContext: UserMessage`。两个生产序列化器均在完整历史末尾追加这个临时 user 消息，绝不插入工具调用和结果之间。Chat Completions 保留 system / user / assistant / tool；Responses 仍把固定 system 映射成 developer，临时上下文映射成 user，function_call / output 与 replay 逻辑不变。没有向公共 MessageRole 增加 developer，也不假定所有模型有相同角色支持。

`<turn-context>` 内使用分区 JSON，转义外部数据中的 & / < / >，明确标为系统提供的数据而非用户请求或授权。当前权威状态优先于历史状态陈述；工具和领域权限仍依靠 Binding / ACL，不依靠提示文字授权。

`llm-requested` 排除临时消息正文，只增加可选 `contextTokens` 数值。F12 计量纳入临时消息成本，usage 锚点重定价也计入旧请求的该成本；旧日志缺省为 0，不增加 SQLite 表或迁移。压缩只选择既有 surface 消息，摘要不接收临时消息；预计与实际压缩后的成本继续保留临时上下文，随后请求再读取最新状态。

### Reminder 与恢复

继续使用 `session/reminder.ts` 的 `lastObservedFacts` / `changedFacts`，不新增通知服务。只有事实变化才追加已有 `context-observed` 元数据事件；提醒正文和每次快照不进入 Session History。当前 Turn 内模型后续请求与重试保留已观察提醒，下一 Turn 重新按已观察事实比较。

review 审查的 Node ID、被审版本和被审 Node Turn ID 作为 `kind=review` 的最小关联事实保存在同一观察事件；验收脚本据此关联 Main review Turn，不再解析持久用户消息里的 checklist，也不保存 checklist 正文。

Node 的 `work-started` 会清除 `pendingFeedback`。为避免临时注入后跨 Turn / 重启丢失返工任务，Node Builder 从已有事件找最近一次 rework / submission / terminal 事实：未再次提交时，返工要求作为当前 runtime-state 恢复；再次提交或进入终态后移除。只有原 pendingFeedback 所属 Turn 生成返工 Reminder，不在每个 Turn 无条件重复旧通知。

### 规则与职责边界

按用户追加授权，删除 AGENTS.md 中强制读取 Harness 源码的前置要求，并去掉后端计划中的同类要求；历史引用保留。取消该要求前，本轮已只读查看固定提交 `687f282e8625c6b8d11ff58211a90524be2e4317` 的 `packages/core/agent-loop/src/agent.ts`（step 中逐请求 refreshContext）及 `runtime-context.ts`（固定提示与运行上下文分离）。采用职责分离和逐请求刷新；不采用其持久化运行上下文投影、自动唤醒或通用插件框架，后续阶段不再以阅读 Harness 为前置条件。

保持 Human Gate、Main / Node 授权、工具参数结构、AutoRun 及取消边界；状态变化只影响下一次已有模型请求，不隐式启动 Agent。没有修改 frontend、RPC 公共契约、检索算法或 Working Board 持久化。`fetch_resource` 保持 resource_id、start_line、max_lines 的原有结构与分页 / 授权语义；仅把 resource_id 描述里的旧 available-resources 名称同步为 resource-catalog。既有 parametersFor / withVisibleResourceRefs 仍按权限枚举 ID / 唯一名称，暂不移除该兼容能力。

## 坑与发现

- 首次类型检查使用当前默认 Node 22；正式验证已改用 Codex bundled Node 24.22.1，PowerShell PATH 先放 Windows System32，避免权限探针环境偏差。
- 手动压缩路径暴露 Cordis 的显式服务依赖要求：Main 增加 resources 注入；Node 继续复用已有动态注入 scope，不绕过服务可用性生命周期。
- 既有测试原先直接从 System Prompt / 历史用户消息检查动态信息，已迁移到独立 Turn Context；工具结果断言仍检查原消息。
- F12 压力测试的 24k 小窗口在 Main review 当前上下文成本下触发不可压缩的固定开销；改用已有 28k 测试预设并将该场景输出扩至 16k 字符，仍要求同一 Node 至少两次真实压力压缩与完整后继审查。未修改生产阈值、选区或失败语义。
- 既有 `tests/command/compact.spec.ts`（446 行）与 `tests/project/runtime/autorun.spec.ts`（406 行）继续保留原有完整场景集合，本次只调整上下文断言 / Profile 调用，不混入分文件重构；NodeSessionService（251 行）继续拥有既有队列、取消和服务 scope 生命周期。
- 新增文件均小于 300 行。`src/resource/context.ts` 较短，但单独拥有临时目录的权限过滤 / 元数据投影边界，并由 Main / Node 使用；`tests/helpers/context.ts` 由多个专项文件共享，均保留独立职责。

## 验证结果与边界

- `pnpm typecheck`：Node 24.22.1，通过。
- 相关专项：64 文件 / 360 项通过；新增专项覆盖逐请求刷新、同 Turn 状态变化与资源授权、提醒去重、只读预览、跨 Project / Node 隔离、双协议工具配对、模型重试、超窗压缩后重建、SQLite 检查点与重启恢复。
- 首轮完整后端测试：155 文件中 154 通过，996 项中 995 通过；唯一失败是 Host Goal 测试仍从固定消息查找动态 goalStatus。已改为检查临时上下文，完整复验 155 文件 / 996 项全部通过（含默认 all 模式下的进程恢复测试，退出码 0，294.36 秒）。
- Resource 参数描述同步后定向复验：5 文件 / 19 项通过。
- `git diff --check`：通过。
- [PR #97](https://github.com/likeWind221/Navo/pull/97)：最终代码 head `35bfd764b3a55843ce209ebbedfdc8ee8b05069e` 的必需 verify 检查成功；[CI run 40188715759](https://github.com/likeWind221/Navo/actions/runs/40188715759) 的 typecheck、normal tests、crash recovery tests 全部成功。2026-10-25 squash 合入 master（`5bdf3f3b2cfcc108b69ffa239e6855367c58775b`）；本地 / 远端开发分支已删除，没有创建本 Step 专用 worktree，保留主仓库及其他任务目录。

仅离线模型和磁盘重启测试；没有发起真实模型、GPU 或新实验，不把离线通过称为真实服务端验收。历史库里已有旧 Reminder 不迁移或删除，当前状态明确覆盖历史状态。过渡目录仍完整注入，资料很多时存在不可压缩的固定成本，F13.4c 通过按需查询解决，不在本阶段静默裁剪造成不可发现。

## 下一步

F13.4a 已完成并停止，本次代码模块导读随交付回复提供。F13.4b 需要定义 Session Working Board 的内容、更新 / 取消 / 持久化与恢复语义，再通过 working-board Provider 提供摘要；F13.4c 需要提供权限内 list_resources 等目录 / 检索工具并完成 discoverability 验收，随后移除临时 resource-catalog Provider 及 Schema 中的全目录 enum 注入。两者均待单独授权。
