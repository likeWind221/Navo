# 78：BUG-005 未知工具名报错被误读为权限拦截

关联：[Bug 跟踪表](bug-plan.md)、[76：F9.10 开发记录](76-devlog-f9.10-goal-confirm.md)。分支 `fix/bug-005-unknown-tool`。

## 现象与复现

- F9.10 五场景验收（`scripts/goal.ts`，`qwen3.8-27b`）第 5、6 轮：模型输出残缺工具名 `write_\n<parameter=reason`，ToolService 返回 `Tool '…' is not allowed for this Turn.`。模型把它当成“平台拦截规划”，于是重新请用户确认，Roadmap 没有落盘。
- 当时只靠 Main 提示词规则 2（同意在本回合内有效，失败调用修正后重试）规避，未改内核。

## 已证实事实与根因

- `ToolService.execute` 先检查本回合 `allowedTools`，后查注册表。残缺或不存在的名字必然不在白名单内，所以一律走 `tool-not-allowed` 分支。已有的 `unknown-tool` 分支（文案 `Unknown tool '…'.`）在有白名单的回合里永远走不到。
- 根因是检查顺序：未知名字被归类成权限拒绝，并非仅仅文案措辞的问题。

## 修复内容

- `src/tools/service.ts`：先查注册表，再判断白名单。
  - 未注册 → `unknown-tool`：`Unknown tool "<name>": no tool with this name exists. Callable tools: …. Correct the tool name and call it again.`
  - 已注册但本回合未选 → `tool-not-allowed`：`Tool "<name>" is not allowed for this Turn. Callable tools: ….`
  - 本回合没有可调用工具时，列表处改为 `No tools are callable in this Turn.`，不提示重试。
- 名字用 `JSON.stringify` 输出，换行显示为 `\n`，残缺名能直接看出来。
- 可调用列表取本回合 `allowedTools`；未传白名单时取全部已注册工具。不暴露本回合之外的工具名。
- DeepSeek Harness 对照：`packages/core/tools/src/index.ts` 的 `ToolNotFoundError` 把“不在本 Agent 视野内”与“未注册”统一报为 `unknown tool "<name>"`（见 `tests/scoped.spec.ts`）。本项目不照搬：Node 调用 Main 专属工具（如 `modify_roadmap`）是真实的权限拒绝，长程测试要求模型看到拒绝语义后改用 `send_to_main`。BUG-005 只需让未注册名字不再冒充权限拒绝。
- 测试：`tests/tools/service.spec.ts` 新增残缺名 / 已注册未授权 / 空白名单三种报错断言。`tests/integration/research.spec.ts` 的 `confirm_completion` 和 `tests/host/turn/v2/lifecycle.spec.ts` 的 `read` 均未注册，原断言 `not allowed` 记录的正是本 Bug 行为，改为 `unknown-tool`。长程测试中真实权限拒绝 `forbidden-replan` 的断言不变。
- Main 提示词规则 2 保留未改：它同时覆盖提案校验失败后的重试，且真实样本只有 3 次，作为冗余防线保留。

## 验证结果与边界

- 本机：Windows 11，Node v24.14.0。`pnpm typecheck` 通过；`pnpm test` 84 个文件、485 个用例全部通过。
- 真实模型：`qwen3.8-27b`，局域网默认端点，thinking 开启。本地临时删除 Main 提示词规则 2（未提交，复验后已恢复），连续跑 5 轮 `npx tsx scripts/goal.ts`，证据目录为本机 scratchpad 下 `ev1`–`ev5`（不入库）。

| 轮次 | 结果 | 残缺工具名 | 说明 |
|---|---|---|---|
| 1 | 8/8 回合通过 | 0 | `write_roadmap` 提案校验失败 1 次，同回合重试成功 |
| 2 | 8/8 回合通过 | 0 | `write_roadmap` 提案校验失败 1 次，同回合重试成功 |
| 3 | 8/8 回合通过 | 1：`extract-goal` 第 2 回合 `write_\n<parameter=roadmap` | 收到 `Unknown tool` 后同回合调用 `write_roadmap` 成功 |
| 4 | 8/8 回合通过 | 2：`prefilled-conflict` 第 2 回合 `write_\noadmap`；`extract-goal` 第 2 回合 `write_\n<parameter=roadmap` | 都在同回合恢复；随后另有一次提案校验失败也重试成功 |
| 5 | 8/8 回合通过 | 0 | — |

- 5 轮 40 个回合中，没有任何工具结果出现 `not allowed for this Turn`；3 次残缺名全部得到 `Unknown tool` 报错，模型都没有停下来重新征求同意。
- 搜索报错 `No search provider is available.` 来自 `createApp` 未注册搜索 adapter，与本 Bug 无关。
- 边界：只验证了 `qwen3.8-27b`，3 次触发属于抽样，不是确定性保证；其他模型是否同样能自行恢复未验证。

## 后续

- BUG-006：本次复验出现了新的残缺形态 `write_\noadmap`。它与 `write_\n<parameter=roadmap` 都在 `write_` 后断开，可作为定位产生环节的线索，仍需保留原始流片段。
