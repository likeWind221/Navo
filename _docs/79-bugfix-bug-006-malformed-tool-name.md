# 79：BUG-006 残缺工具名根因定位

关联：[Bug 跟踪表](bug-plan.md)、[76：F9.10 开发记录](76-devlog-f9.10-goal-confirm.md)、[78：BUG-005 修复笔记](78-bugfix-bug-005-unknown-tool.md)。

**状态：** 2026-10-09 完成根因定位；同日按方案 B 将工具改名为 `create_roadmap`，以 BUG-005 的 `unknown-tool` 反馈作为恢复策略，达到关闭条件。分支 `fix/bug-006-roadmap-rename`。

## 现象与复现

- 真实模型 `qwen3.8-27b`（thinking 开启）在规划回合调用 `write_roadmap` 时，多次产生 `write_\n<parameter=roadmap`、`write_\n<parameter=reason`、`write_\n<parameter=action`、`write_\noadmap`、`write_` 等残缺工具名。
- 运行时由 BUG-005 修复后的 `unknown-tool` 报错引导模型在同回合重试，不阻断规划，但每次多耗一步、且残缺调用的参数会丢失。
- 稳定复现：抓取一次出错时的完整请求体（Main，`prefilled-conflict` 第 2 回合，`set_project_goal` + `read_roadmap` 之后的那一步），原样非流式重放 6 次，6 次都出现残缺名。

## 排查方法

- 在本机 scratchpad 下用 `node --import` 预加载一个 fetch 包装：只 tee `/chat/completions` 的响应，原始 SSE 落盘；流中出现非法工具名时另存完整请求体。项目代码未改动。
- 对抓到的请求做三类重放：
  - 流式 + `logprobs`；
  - 非流式 + `logprobs`：流式下 vLLM 会丢弃被 tool parser 暂存 token 的 logprobs，非流式能拿到全部生成 token；
  - assistant 预填 `<tool_call>\n<function=write_`，配合 `continue_final_message`、`max_tokens: 1`，读下一个 token 的分布。
- 后端识别：chunk 带 `prompt_token_ids` / `token_ids` 字段，tool call id 形如 `chatcmpl-tool-<16hex>`，判断为 vLLM OpenAI 兼容服务（前面有一层网关，未开放 `/tokenize`）。

## 已证实事实

1. **适配层没有参与**：vLLM 在单个 delta 中一次性下发完整工具名。正常调用如 `{"name":"web_search"}`，残缺调用如 `{"name":"write_\n<parameter=reason"}`，都只有一个 name delta。`translateQwenSse` 的名字拼接只处理这一段，不产生或改写内容。
2. **服务端 parser 没有篡改，但也没有校验**：残缺调用的参数里，`nodes` 是转义后的 JSON 字符串；同回合正确调用里，`nodes` 是数组。说明服务端按函数名查 schema 做类型转换，查不到时全部当字符串处理。也就是说，vLLM 的 Qwen XML parser 把 `<function=` 到第一个 `>` 之间的文本原样当成函数名，不检查它是否在请求声明的工具列表里。
3. **残缺内容来自模型原始输出**：非流式 logprobs 还原出的原始 token 依次为 `<tool_call>` `\n` `<` `function` `=` `write` `_` `\n` `<` `parameter` `=` `reason` `>` …。`write_` 之后的 `\n` 是模型自己生成的：

| 样本 | `write_` 后生成的 token | 该 token 概率 | `road` 概率 |
|---|---|---|---|
| ns1 | `\n` | 0.65 | 0.35 |
| ns2 | `\n` | ≈1.00 | <0.001 |
| ns6 | `\n` | ≈1.00 | 不在 top5 |

4. **不是采样随机性**：同一请求在 `temperature: 0`（贪心）下 3/3 出错，`temperature: 0.3` 下 3/3 出错。在这个上下文里，`\n` 就是模型的最高概率选择，降温只会让错误更确定。
5. **与工具名强相关**：把请求中所有 `write_roadmap` 替换为 `create_roadmap`（工具定义、提示词、历史一并替换），同样在温度 0 下 3/3 正常调用 `create_roadmap`。
6. **与上下文有关**：预填实验中，去掉工具定义或去掉 system + 首条 user 之后的历史，P(`\n`) 在所有组合下都为 0。只有工具定义和完整历史同时存在，才会诱发。
7. **Token 切分不是原因**：推理文本和函数名中，`write_roadmap` 都切分为 `write` `_` `road` `map`。

## 被否定的假设

- “并行工具调用诱发”：预填实验中，把消息 4 的并行调用拆成串行后，P(`\n`) 从 0.94 降到 0。但用完整生成验证，拆成串行后仍 4/6 出错（原版 6/6），预填结果有偏差，此假设不成立。
- “适配层流式拼接错误”：见事实 1。

## 根因结论

- 产生环节：**模型输出**。`qwen3.8-27b` 在特定上下文中，用 Qwen XML 工具调用格式写 `<function=write_roadmap>` 时，于 `write_` 之后高概率生成换行，随后写成 `<parameter=…` 或 `oadmap`。
- 放大环节：**推理服务端 tool parser 不校验函数名**，把残缺文本作为合法 `tool_calls[].function.name` 返回，并丢失被吞入名字区段的参数（如 `reason`）。
- Navo 适配层与 ToolService 如实传递；BUG-005 修复后，模型能收到“名字不存在”的提示并重试。
- 未证实：模型为何对 `write_` 前缀格外敏感。一个可能的诱因是常见编码 Agent 工具命名（`write` / `write_file` 一类）留下的先验，Navo 自身也有名为 `write` 的文件工具（不在 Main 工具集中）。这只是假设，未做验证。

## 可选处置（待用户决定，未实施）

| 方案 | 作用 | 代价 / 风险 |
|---|---|---|
| A. 维持现状：靠 BUG-005 的 `unknown-tool` 报错重试 | 零改动，真实验收中均能恢复 | 每次多一步；残缺调用的参数丢失，需要整段重写 |
| B. 重命名工具（如 `write_roadmap` → `create_roadmap`） | 对照实验中温度 0 下 3/3 消除 | 只验证了一个上下文；工具名、提示词、测试、前端展示都要同步改；不保证其他名字不受影响 |
| C. 推理服务侧：tool parser 校验函数名，或开启约束解码 | 从格式层面杜绝 | 不在本仓库控制范围内，需要协调部署方 |
| D. 适配层“修复”残缺名（如前缀匹配） | 少一步重试 | 属于猜测性修改，参数也已丢失，不建议 |

建议先 B 后 A 兜底：扩大样本，确认重命名后多个场景都能消除问题后再改名；A 作为长期兜底保留。

## 验证边界

- 只测了 `qwen3.8-27b` 和单一部署；对照实验基于一个抓取的请求，结论的普适性还需要在多个场景中复验。
- 原始 SSE、请求体和重放结果保存在本机 scratchpad 的 `probe/keep/`，不入库。
- 后台抓包在 `extract-goal` / `prefilled-conflict` 各跑约 2 轮后提前停止，期间抓到 2 次残缺名；遗留的 tsx 子进程已手动清理。


## 修复内容（方案 B + A）

- 工具 `write_roadmap` 改名为 `create_roadmap`，与描述 "Create the initial Roadmap" 一致：
  - 导出符号和文件一并改名：`CREATE_ROADMAP_TOOL_NAME`、`CreateRoadmapTool`、`createCreateRoadmapTool`、`src/tools/builtins/roadmap/create-roadmap.ts`；
  - Main 提示词、`modify_roadmap` 的引导文案、demo / longterm 脚本、测试、README 和 `backend-plan.md` 同步更新；
  - 历史开发记录保持原名不改；前端没有引用这个工具名；运行时没有持久化的旧会话，不需要迁移。
- 工厂函数沿用 `create` + 工具名的约定（同目录有 `createModifyRoadmapTool`、`createReadRoadmapTool`），所以名为 `createCreateRoadmapTool`。
- 恢复策略：模型仍可能产生残缺名，此时由 BUG-005 修复后的 `unknown-tool` 报错（附可调用列表与重试提示）引导模型在同一回合重试。验收口径：残缺名允许出现，但必须在同回合恢复，不得出现未恢复错误。
- 未采用：适配层猜测修复名字（方案 D）。推理服务侧校验函数名或约束解码（方案 C）不在本仓库控制范围内，作为上游改进建议保留。

## 修复后验证

- 本机：`pnpm typecheck` 通过；`pnpm test` 84 个文件、485 个用例全部通过；`rg` 确认 `src`、`tests`、`scripts`、README 中没有旧名残留。
- 受控对照（使用同一个稳定复现的请求，只替换工具名）：

| 条件 | `write_roadmap` | `create_roadmap` |
|---|---|---|
| 默认温度，各 6 次 | 6/6 残缺 | 0/6 |
| 温度 0，各 3 次 | 3/3 残缺 | 0/3 |

- 全流程真实验收（`qwen3.8-27b`，thinking 开启，Main 提示词规则 2 保留，抓包钩子检查全部工具名，共 119 次模型请求）：

| 运行 | 结果 | 残缺名 |
|---|---|---|
| goal 第 1、3、4、5 轮 | 8/8 回合通过 | 第 4 轮 `extract-goal` 第 2 回合出现 1 次 `create_
<parameter=reason`，同回合恢复 |
| goal 第 2 轮 | 7/8；`extract-goal` 第 2 回合 blocked | 0；失败原因是推理耗尽 8192 输出 token（max-tokens），与本 Bug 无关，另登记为 BUG-007 |
| longterm | 10/10 回合通过，0 个未恢复错误 | 0 |

- 对比：改名前同口径 5 轮共 15 个规划回合，出现 3 次残缺名；改名后 14 个进入规划的回合中出现 1 次。样本量不足以给出精确比率；降幅的主要证据是受控对照。
- 结论：改名大幅降低了触发率，但没有根治。同样的形态以 `create_` 前缀出现了一次，说明模型在“动词 + 下划线”之后插入换行的倾向仍然存在。残缺名出现时，已由 `unknown-tool` 反馈在同一回合内恢复。

## 剩余边界

- 只验证了 `qwen3.8-27b` 和单一部署；换模型后可能对其他名字敏感。
- 如需根治，需要推理服务侧对函数名做校验或约束解码。
