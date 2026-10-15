# 99：BUG-010 Roadmap 工具参数与运行时约束不一致

日期：2026-10-14 排查，2026-10-15 尝试修复后回退；同日删除控制节点完成修复实现。状态：离线验证通过，待真实模型验收，未勾选。

## 现象与复现

F5.4 真实 Electron 验收使用 `gpt-6-luna`，分别创建预填目标和目标留空的 Project。两条路径都完成了 Main 多轮对话与目标确认，目标留空路径成功执行 `set_project_goal`；随后两条路径的 `create_roadmap` 都连续失败，Roadmap 保持为空。

界面文本记录的 8 次失败全部落在 `nodes[0]`：6 次为 control 节点携带 `goal` / `done_when`，2 次为 work 节点携带 `control`。F5.4 只保留了界面文本（f5.4 worktree 的 `frontend/qa-output/f5-4-real-results.json`），没有原始工具参数。

## 已证实事实与根因

- 根因已确认：工具向模型公布的 Schema 是单个扁平对象，`goal`、`done_when`、`control` 对任何 `kind` 都合法，“仅属于某类节点”只写在字段描述里；运行时解析器按互斥联合拒绝跨分支字段。模型的参数符合公布的 Schema，却违反了模型看不见的约束。
- `ToolService` 已用同一份 Schema 做结构校验（`src/tools/schema.ts`），支持 `type / enum / properties / required / additionalProperties / items`，不支持 `anyOf`。
- 控制节点不是纯展示：必填前驱未完成或跳过时，后继不会解锁（`src/roadmap/graph.ts` 的 `requiredBefore`），控制节点又不能执行，只能由 Human 确认或跳过。因此 required 控制节点等于人工关卡，optional 控制节点不阻塞。
- 推测（未证实）：模型把扁平 Schema 理解为“每个字段都填”。gpt-6-luna 的原始参数仍未取得。

DeepSeek Harness 对照（本机 `D:\Program\Miracle\kernel`，commit `277c141`）：`packages/core/tools/src/schema.ts` 的 `validateArgs` 用同一份声明生成模型 Schema 并校验参数，Navo 已是同一机制；Harness 的工具输入基本为扁平参数，`oneOf` 主要用于输出 Schema。`packages/goal/tool-goal/src/index.ts` 的 `update_goal` 同样用“valid only with action edit”式条件字段，Harness 没有可直接采用的更优形状，本次在其基础上把条件字段从结构上去掉。

## 修复内容

2026-10-15 在分支 `fix/bug-010-roadmap-schema` 上尝试过一版修复，经 Qwen 对照后按用户决定**整体回退，未合入任何生产代码**。尝试内容：

- `create_roadmap` 参数改为 `reason`、`work_nodes`、`checkpoints`，两类条目都是全部字段必填、`additionalProperties: false` 的扁平对象，去掉 `kind` 和条件字段；跨分支字段改由 `ToolService` 的结构校验直接拒绝。
- Navo 自动生成 optional 的 start / end 控制节点，展示顺序按依赖做稳定拓扑排序；工具描述附带最小正确示例，未知依赖的报错列出已知 key。
- 未做 strict 开关：Qwen 端点接受 `strict` 字段，但对照看不出服务端是否强制约束；gpt-6-luna 额度用尽，无法探针。

## 验证结果与边界

环境：本机 Windows，`qwen3.8-27b`（`http://192.168.99.2:8090/v1`，thinking 开启），`scripts/goal.ts` 的 5 个场景，其中 3 个会创建 Roadmap；改前、改后各 5 轮，改前在 master 快照上跑，统计每个 Turn 第一次 `create_roadmap` 是否通过。

| | 首调合法 | 调用总数 | 最终建成 Roadmap |
|---|---|---|---|
| 改前（`nodes` 单数组） | 14/15 | 17 | 15/15 |
| 改后（`work_nodes` + `checkpoints`） | 12/15 | 19 | 15/15 |

- 改前唯一失败：漏填 `required` / `key`，第 3 次调用成功。
- 改后 3 次首调失败：2 次 `work_nodes` 被序列化为字符串，且字符串本身是坏的 JSON（一次把 checkpoints 内容写进了 `work_nodes`，`checkpoints` 参数缺失），服务端只能原样当字符串传过来；1 次 `goal` 为空，同回合修正。另有一轮在两次失败后把计划缩成 1 个节点。推测 Qwen 按参数逐个输出时，在两个大数组参数的交界处容易写乱；单数组时未出现。
- 改后本地 `pnpm typecheck` 通过，Roadmap / Host / 集成测试通过；auth 与 standalone Session 用例在 master 快照上同样失败，属于本机沙箱环境问题。
- 未验证：gpt-6-luna（额度用尽），所以没有证据表明这版能修复 BUG-010 本身。
- 额外发现：控制节点不是纯展示。required 控制节点不能执行，只能由 Human 确认或跳过，它未完成时后继不会解锁，等于人工关卡（`src/roadmap/graph.ts` 的 `requiredBefore`）。


## 2026-10-15 复现：gpt-6-sol（F10.5 真实验收）

- 环境：`scripts/rework.ts`，ChatGPT 订阅，`gpt-6-sol`，`maxSteps: 16`，`maxModelRetries: 0`；本机 Node 22.23.1。
- 第 1 回合 Main 复述目标并请求同意，未规划，符合预期。第 2 回合用户同意后，Main 先 `read_roadmap`，之后 15 次 `create_roadmap` 全部被拒，回合在 16 步上限处 `blocked`，没有创建 Roadmap。
- 15 次失败的原始参数形态相同：`kind: "work"` 的 evidence 节点同时带 `"control": "checkpoint"`，错误均为 `nodes[0].control is valid only for control Nodes.`。收到这条报错后，模型 15 次都没有删掉该字段，只是改写了 `reason`。
- 结论：BUG-010 的直接失败点（扁平 Schema 允许跨分支字段，约束只写在描述里）在 gpt-6-sol 上同样成立；而且这次只出现了 work 节点误带 `control` 这一种形态。同一字段被连续拒绝 15 次，说明仅靠报错文案无法让该模型自行恢复。
- 证据：本机 scratchpad `rework-run1/02-01-plan.json`、`failure.json`（未入库）。

## 后续

- BUG-010 保持未修复。再次修复时须同时满足：gpt-6-luna 不再出现跨分支字段，且 Qwen 首调合法率不低于 14/15 基线。
- 已评估、待选的方向：单个 `work_nodes` 数组加必填的 `review_after`，由 Navo 插入 checkpoint；或单数组加 `type`，让 checkpoint 也带目标与验收标准（需要改 Node 领域模型）。
- 订阅额度恢复后，先取得 gpt-6-luna 失败调用的原始参数，再定方案。
- 修复验收需同时覆盖 gpt-6-sol：F10.5 真实验收在它上面被本 Bug 阻断。

## 2026-10-15 修复：删除控制节点

### 修复内容

- 用户决定不再在 Schema 上拆分 work / control 分支，而是整体删除控制节点（start / end / checkpoint）。理由：start / end 只起展示作用；required checkpoint 是人工关卡，但 F10.4 起每个 Node 都要由 Human 或 Main 确认后才解锁后继，已经覆盖该关卡。设计记录见 [80](80-devlog-f10-0-design.md) D12。
- `create_roadmap` 的 `nodes[]` 条目为 `key / title / goal / done_when / required / depends_on`，全部必填、`additionalProperties: false`；`modify_roadmap` 的 `add_node` / `edit_node` 去掉 `kind` / `control`。Schema 中不再存在只对某类节点合法的字段，公布的 Schema 与运行时约束一致，多余的 `kind` / `control` 由 `ToolService` 结构校验拒绝。
- Node 模型、创建输入与新事件只有工作节点；公共契约 `NodeV1` 在 v1 内去掉 `kind` / `controlPurpose`（前端未消费这两个字段，`frontend-plan.md` 已登记）。
- 旧数据（方案 A）：不改写已存事件。恢复计划丢弃首个事件为 `control-created` 的 Node 历史（`src/storage/recovery.ts`），Roadmap 重放把 `前驱 -> 控制节点 -> 后继` 旁路为 `前驱 -> 后继`（`src/roadmap/legacy.ts`、`projector.ts`）；引用过旧控制节点的活跃 Project 在启动时解锁依赖已满足的 Node。已知边界见 [80](80-devlog-f10-0-design.md) D12。
- 分工：RPC 契约、后端、前端计划分别由三个子 Agent 修改，编排者统一验收并维护本笔记、Bug 表与索引。
- 文件规模：`src/storage/recovery.ts`（350 行）与 `src/tools/builtins/roadmap/modify-roadmap.ts`（373 行）本次之前已超过 300 行，本次前者 +15、后者 -37。前者只负责构建恢复计划，后者是一个工具的 Schema、解析与失败文案，均为单一变化原因，本次不拆分。
- DeepSeek Harness 源码不在本次运行环境中，未重新对照；沿用上文结论（Harness 工具输入同为扁平参数，无更优形状）。

### 验证结果与边界

- 环境：云端容器，Node v22.22.0。
- 后端：`pnpm typecheck` 通过；`pnpm test` 656 通过、6 失败、3 跳过。6 项失败位于 `tests/host/process.spec.ts` 与 `tests/tools/shell/execution.spec.ts`，在同一容器的 master 上同样失败（shell / 进程信号环境问题），与本次无关。
- RPC：`pnpm vitest run --config rpc/vitest.config.ts` 46/46 通过，含携带 `kind` / `controlPurpose` 的 Node 被拒绝。
- 前端：`frontend/` 下 `pnpm typecheck` 通过，`pnpm test` 135/135 通过。
- 新增回归：`tests/roadmap/legacy.spec.ts` 覆盖旧数据库（start -> A -> required checkpoint -> B，后续变更加入 end，以及旧控制节点上的确认、改定义和 Roadmap 更新事件）恢复为 [A, B]、边 A -> B，B 解锁，已存记录不变，恢复后的新变更在再次重启后重放一致；`create_roadmap` / `modify_roadmap` 测试覆盖新形状与多余字段拒绝。
- 未验证：真实模型。关闭本 Bug 仍需在本机完成：Qwen `scripts/goal.ts` 5 轮首调合法率不低于 14/15；gpt-6-luna 与 gpt-6-sol 能创建 Roadmap；随后重跑 `scripts/rework.ts` 完成 F10.5 真实验收，以及 F5.4 预填 / 空目标 Electron 真实验收。

## 2026-10-15 真实模型复验（云端容器）

- 环境：Claude Code 云端容器，Node v22.22.0，ChatGPT 订阅（容器内登录），命令均带 `NODE_USE_ENV_PROXY=1`（Node 内置 `fetch` 默认不走容器代理）。
- gpt-6-luna，`scripts/goal.ts` 5 个场景：全部通过（`{"failed":[]}`）。3 个规划场景各 1 次 `create_roadmap`，首调全部合法（3/3，0 次被拒），分别创建 3–4 个工作节点（链式或菱形依赖，每节点 2–3 条完成标准）；闲聊与模糊意图场景未提前规划。修复前 F5.4 中 luna 的 8 次调用全部被拒。
- gpt-6-sol，`scripts/rework.ts`：确认与规划回合通过，首次 `create_roadmap` 即创建 evidence -> synthesis 两个必选工作节点，0 次被拒（修复前 15 次全部被拒）。
- 第 3 回合起 F10.5 场景未通过，与本 Bug 无关：evidence 节点读到 draft.txt 中 “Source: not recorded” 后判断完成标准未满足，按 `submit_completion` 说明（“认为目标完成时提交”）拒绝提交，改用 `send_to_main` 报告缺少来源；场景期望它提交后由 Main 返工。需另行决定场景或 Node 提交语义。
- 复验中发现 #63 漏改：`scripts/rework.ts` 仍按 `node.kind === "work"` 查找节点，导致规划成功后报 `Missing node evidence`；该脚本不在根 tsconfig 的 include 中，typecheck 未覆盖。已删除这两处判断并把脚本加入 include（用包含全部 `scripts/**` 的临时 tsconfig 检查，修复前恰好报这 2 处错误，修复后无错误）。
- 基础设施噪声：多次运行的首个请求收到 HTTP 520（Cloudflare），模型未执行，不计入结论；探测请求同期均为 200，原因未查明。最后一次运行在 Navo 外层包装 `fetch`，对 520 透明重试至多 3 次，实际未触发。
- 证据（未入库）：容器 scratchpad 的 `goal-luna2/`、`rework-sol5/` 与各 `*-520/` 目录。
- 仍未验证：Qwen 本机 5 轮首调合法率对照、F5.4 预填 / 空目标 Electron 真实验收（需本机），因此 BUG-010 保持未勾选。

