# 157：BUG-031 图谱抽取与订阅模型参数不兼容

日期：2026-10-26。所属：后端；优先级 P1（阻断本次所选模型路径）。状态：**仅排查，未修复**。跟踪项见 [Bug 表](bug-plan.md)。

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

等待用户单独确认修复范围。修复应明确区分 Provider 的请求能力与图谱预算的执行边界，不能在验收脚本偷偷剥离参数后宣布生产链路已修复。

关闭需：必要的参数兼容修复与离线回归、完整本地检查、当前 PR head CI，并在重新报告预算和获授权后完成所选订阅 Provider 的真实图谱构建与跨资料 Main / Node / Review 验收。未完成前 BUG-031 保持未勾选，F13.6 真实后端链路不能记通过。
