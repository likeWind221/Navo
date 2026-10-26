# 157：BUG-031 图谱抽取与订阅模型参数不兼容

日期：2026-10-26。所属：后端；优先级 P1（阻断所选模型路径）。当前状态：**参数组装修复已合入 PR #102，两份真实图谱成功，完整任务待验**。跟踪项见 [Bug 表](bug-plan.md)。首次失败与当时未修复的事实保留如下，本次修复追加在后文。

## 现象与复现

用户授权 F13.6 后端真实验收一次：生成请求最多 48（含图谱 / 摘要）、Embedding 最多 20、总时限 20 分钟，只使用已有服务，失败不自动重跑。

Node v24.22.1 下执行 `pnpm exec tsx scripts/library.ts --real`。三份用户资料保存、正文处理与向量构建成功，但三份图谱构建均 `failed / model-failed / next_ordinal=0`，入口断言 graph active 失败；Main 规划、Node 执行及 Review 尚未开始。没有重跑。

原始现场保留：

- `C:\Users\likeW\AppData\Local\Temp\navo-f136-real-ERHQta\navo.db`
- 同目录 `intake\`、`workspace\`、`evidence\intake.json`、`failure.json`、`requests.json`
- 标准输出日志 `C:\Users\likeW\AppData\Local\Temp\navo-f136-20261026\real.log`

入口记录耗时 821ms。3 次 Embedding HTTP 请求返回 200，耗时分别 141 / 171 / 114ms，每次一个输入。模型账本记录 3 次图谱适配器调用失败，消息均为：

```text
ChatGPT subscription requests do not support maxTokens or temperature.
```

这 3 次是本地适配器尝试，不能写成 3 次已发送的生成 API 请求或成功模型推理；拒绝位置在取 token 与 fetch 之前，因此此路径实际发送的生成 HTTP 请求为 0，不产生该路径的生成 token 消耗。未读取账号余额，也未声称测得准确订阅余额变化。Embedding 已实际调用已有 GPU 服务。

## 已证实事实与根因假设

根因置信度：**已确认当前模块配对不兼容**。

1. `src/resource/graph/extraction.ts` 的 `GraphExtractor.request()` 固定发送 `maxTokens: this.outputLimit` 与 `temperature: 0`，同时附上 `extract_graph` 工具。
2. `src/llm/adapters/openai.ts` 的 `OpenAIAdapter.stream()` 在任何鉴权和 HTTP 调用前检查这两个字段；任一存在即抛 `UNSUPPORTED_PARAMETER`。
3. 本次入口为 GraphConfig 显式选择 `openai / gpt-6-luna`，并按现有验收入口注册该订阅适配器。3 份资料持久化的 graph pipeline 均为 `["graph-v1-nfc-exact","openai","gpt-6-luna",8192,4096]`，状态均为 failed，账本错误与源码一致。

该证据不支持“网络失败”“额度不足”“模型不会抽图谱”或“Embedding 服务故障”的结论；本次尚未到达这些生成环节。也不能推断所有模型 Provider 都不支持图谱，问题范围为当前 GraphExtractor 与订阅适配器的组合。

## 修复内容

**无生产代码修复。** 没有删除参数、绕过适配器校验、改用其他模型、重试原数据库或重新跑任务；没有改动真实失败状态。新建验收资产和离线通过事实见 [156](156-devlog-f13-6-backend-acceptance.md)。

## 验证结果与边界

- 一次授权的真实入口运行复现失败；失败现场、最终调用账本和 SQLite 保留。
- 只读检查 SQLite graph_builds 与相关源码；没有触发额外推理请求。
- 离线完整后端 161 文件 / 1041 项通过，新增 9 项组合测试通过；它们使用固定图谱模型响应，不覆盖这个真实 Provider 配对，因此不构成 BUG-031 修复证据。
- 正式 Host 尚未接入 graph 配置是另一个已记录的交付边界，不是本次适配器拒绝的原因；不将两者合并归因。
- 验收资产见 [Draft PR #100](https://github.com/likeWind221/Navo/pull/100)，代码提交 `c386ab7244f2b507e04f90ad39910c0baa9ba281`；此提交只增加验收脚本 / 测试与记录，没有修复 BUG-031。
- 上述代码 head 的 [CI run 40287820719](https://github.com/likeWind221/Navo/actions/runs/40287820719) 成功；普通与中断恢复测试通过不改变本项真实失败或关闭状态。

## 后续与关闭条件

首次排查时等待用户确认修复范围。用户随后授权最简单的图谱专用参数修复；本次实现见下节。修复明确区分 Provider 的请求能力与图谱预算的执行边界，没有在验收脚本偷偷剥离参数。

关闭需：必要的参数兼容修复与离线回归、完整本地检查、当前 PR head CI，并在重新报告预算和获授权后完成所选订阅 Provider 的真实图谱构建与跨资料 Main / Node / Review 验收。未完成前 BUG-031 保持未勾选，F13.6 真实后端链路不能记通过。

## 2026-10-26：图谱专用参数修复

基线：最新 master `ae5445b`；独立分支 `fix/bug-031-graph-parameters`。只修改图谱配置 / 请求组装、相关测试及记录；不改订阅适配器、不改前端、不调用真实模型 / Embedding。前次资料、SQLite 和失败状态未触碰。

### 修复流程与代码职责

```text
GraphConfig.model: provider / model / optional maxTokens / temperature
                               |
                               v
GraphExtractor.request: send exactly the graph configuration
                               |
                               v
existing LLMService -> existing adapter -> validateGraph -> persistence
                               |
                               v
existing stream size / timeout / cancellation controls
```

- `src/resource/graph/extraction.ts`：GraphConfig.model 复用 GenerateRequest 对应的四个字段类型，图谱模型和生成参数独立于 Main / Node 配置。request 只展开图谱配置，不再硬编码 maxTokens 或 temperature；默认省略两项，显式配置则按原值传递。maxTokens 只校验正安全整数，temperature 只校验有限数，不额外施加通用的模型参数范围；具体接口仍可以拒绝它不支持的字段。
- `outputTokenLimit` 保留现有配置名与本地语义：默认 4096，对应累计可见输出 4096 * 16 = 65536 字节的接收限制；它不再隐式变成服务端 maxTokens。60 秒超时、取消、结构校验与已有有限格式重试 / 拆批继续复用；支持的接口需要服务端 token 上限时，显式配置 model.maxTokens。
- 图谱 pipeline 升为 `graph-v2-explicit-parameters`，版本标识额外包含实际配置的 maxTokens / temperature。省略字段以 null 规范化；对象字段顺序不影响版本。参数或默认请求形态变化后，旧图谱沿用 GraphStore 的 superseded / 重建规则，不能复用为新配置结果。未来在启用真实 graph 的应用中打开旧库可能安排重建；本轮仅测试临时库，没有打开原失败库。
- `tests/resource/graph/extraction.spec.ts`：覆盖默认不注入参数、显式值不被本地预算覆盖、无效数值拒绝、参数变化使 pipeline 不同；复用原有超限、取消、拆批与失败测试。
- `tests/resource/graph/subscription.spec.ts`：组合真实 Graph 服务、订阅适配器、模拟 Responses SSE 和 SQLite；校验发出的 JSON 没有未配置的字段，响应可被抽取和持久化，graph 达到 active 并能读取来源证据。没有真实鉴权或 HTTP 推理。

配置示例：

```ts
graph: {
  model: { provider: "openai", model: "gpt-6-luna" },
  inputTokenBudget: 8192,
  outputTokenLimit: 4096,
}
```

对于接受相应参数的接口，可在图谱自己的 model 中显式配置 `maxTokens: 4096, temperature: 0`；不从其他 Agent 的设置继承，也不在适配器中静默删除用户设置。

### 验证与交付边界

- Node v24.22.1、Windows PowerShell、System32 在 PATH 前；没有修改持久环境或安装依赖。
- `pnpm typecheck`：通过。
- `pnpm test tests/resource/graph tests/llm/adapters/openai.spec.ts --maxWorkers=4`：6 文件 / 37 项通过，4.49 秒。
- 初轮新测试有 TypeScript exactOptionalPropertyTypes 用法错误和模拟响应输入格式错误，均只修正测试；没有改生产协议来迁就测试。
- 完整 `NAVO_TEST_MODE=all pnpm test --maxWorkers=4`：159 文件 / 1037 项全部通过，343.61 秒，包含完整 D1–D8 和正文中断恢复。日志目录 `C:\Users\likeW\AppData\Local\Temp\navo-bug031-20261026`。
- [PR #102](https://github.com/likeWind221/Navo/pull/102) 代码 head `ce3fa89d1bc8826ec9697b7b078929760a72b0bb` 的 [CI run 40296557374](https://github.com/likeWind221/Navo/actions/runs/40296557374) 第二次执行成功，typecheck、normal tests 与 crash-pr 组全部通过；于 2026-10-26 squash 合入 master（`289f4cecc60b4a0aa0661b72a58bbab929401e62`）。本地 / 远端修复分支已删除，无本 Step 专用 worktree，主目录及 PR #100 分支保留。
- CI 首轮普通组 4 文件 / 5 项超时，另有一次 SQLite 清理 EBUSY；日志保留为 `ci-failed.log`，没有改超时或相邻模块。对应 4 文件 / 23 项在同代码修复分支和基线 master `ae5445b` 上分别通过，5.59 / 4.54 秒，日志为 `ci-cases-branch.log` / `ci-cases-master.log`。仅对同一代码 head 重跑失败 CI 一次后通过；原因未确认，不把复跑通过写成已定位或修复了 CI 环境。
- 真实模型 / Embedding / GPU 调用为 0；本地组合验证不能替代真实服务器兼容验证，BUG-031 暂不关闭，F13.6 保持进行中。
- 本修复从 master 独立开发，未引入 Draft PR #100 的验收脚本 / 测试。为保留已发生的验收证据和连续编号，将该 PR 中 155–157 三份历史记录一并登记；156 所述验收代码仍在 PR #100，不能视为本修复已合入这些代码。

下一步：代码修复已按本地 / 当前 head CI 门禁合入并完成分支清理；需要真实复验时重新报告预算并获得授权，不复用此前一次性运行授权。BUG-031 的真实关闭条件不因代码合入而免除。本次代码导读随交付回复提供。

### 修复后首次真实复验

2026-10-26 用户重新授权的一次复验已执行，未重跑。类型检查、相关 46 项专项及零推理预检通过；真实运行在 Embedding 连接阶段失败，图谱和所有生成调用尚未开始。详情见 [158：BUG-032](158-bugfix-bug-032-embedding-connectivity.md)。此次没有观察到旧参数错误，但也未执行到该路径，BUG-031 保持待真实复验，不勾选关闭。

### 使用 OpenRouter 的后续真实复验

2026-10-26 用户授权切换 OpenRouter Embedding 完整验收，详见 [160](160-devlog-f13-6-openrouter-acceptance.md)。三份资料中，两份向量索引与对应真实图谱均 active，图谱 next_ordinal=1，pipeline 中 maxTokens / temperature 均 null，旧参数错误未复现。第三份 Embedding 触及 15 秒超时，完整任务在 Main 规划前停止，登记 [BUG-033](161-bugfix-bug-033-openrouter-timeout.md)。因此现已获得真实图谱成功证据，但完整两 Node / Main Review 关闭条件仍未满足，本项保持未勾选。原始现场 `%TEMP%/navo-f136-real-1c6qU9`；没有重跑。

用户之后分别授权调整单次时限为 60 秒复验，以及修正确认流程后再次复验。最新第三轮三份原文及 comparison.md 的索引与真实图谱全部 active，Node A 搜索返回真实图谱来源路径，Main 首次 Review 与同库重开通过；原参数错误未复现。完整任务停在 Node B 来源声明校验，属于独立 [BUG-035](163-bugfix-bug-035-node-source-evidence.md)，最终 Main Review 未执行。BUG-031 的具体参数修复已获得真实成功证据，既有完整任务关闭条件仍未全部满足。
