# Interaction Bench（iBench）适配核查

日期：2026-10-31。仅阅读官网与公开文档；未克隆仓库（GitHub 与 raw 直连解析失败）、未构建环境、未运行评测，也未改动源码。

## 做了什么

1. 读官网首页、`/methodology`、`/tasks`、`/environments`、`/pipeline`、`/leaderboard`、`/docs/quickstart`、`/docs/contribute`，以及样例任务 `photo-map-panning`。
2. 对照 Navo 现有能力：Core 定位（Adaptive Roadmap / Verification / Replanning）、工具集（read/write/edit/shell/web）、[187](187-devlog-harness-bench.md) 已完成的 Harness-Bench general 274 基线。

## 基准事实（已核实）

| 项目 | 事实 |
|---|---|
| 规模 | 44 题、25 个开源应用、8 个领域（v0.1 preview） |
| 题型 | 从已合并 PR 中挑出的**用户可见交互缺陷**：给 agent 用户意图 + 源码 + 可运行环境，交一个 patch |
| 构造 | 4356 PR → 定义评审 112 → 维护者修复校验 73 → 试跑评审 65 → 发布 44 |
| 规格 | BDD 式：Intention / Given·When·Observed / Rationale / Require·Allowed |
| 判分 | 判分 agent 用 setup 脚本复现 Given、replay 脚本执行 When、按 Require 与 Allowed 判行为；环境/执行/证据失败与产品失败分列；单题全部 check 通过才算 pass |
| 运行 | Linux + uv + Docker Compose，`uv run ibench run` 配 solver/scorer config；`.env` 里放 `DEEPSEEK_API_KEY` |
| 榜单 | 6 个原生 coding harness：GPT-6 Astra/Codex 34.1%，Claude Opus 5.5 27.3%，DeepSeek Flash/DSH 15.9%，GLM-5.3 9.1%，Qwen3.8 6.8%，Kimi K3 4.5% |
| 成本 | 每题 $0.3–3.5、10–60 分钟；样例题 DSH 130 步 / 21 分钟 |

## 关键结论

**不适合作为 Navo 的主评测口径**，三条理由按重要性排列：

1. **能力维度错位。** 它测的是"在一个陌生仓库里定位一个 UI 交互缺陷并修好"，平均十几分钟、单缺陷、单 patch；Navo 的主张是长程 Roadmap 的插入/替换/重规划与证据驱动验证。用 iBench 打分等于只测了尚不存在的 Coding 垂直，测不到 Core 的差异点。
2. **工具与栈不覆盖。** 解题侧要一台能跑起来的 web 应用加浏览器；任务筛选明确把"单看代码就能定位"的问题剔除（试跑评审阶段 reject），所以只看 shell + 文件的 agent 会被结构性削弱。25 个应用是 PHP / Go / Ruby / Clojure / JS 的第三方项目，与 Navo 的 Electron + Research 栈没有交集，接入成本高且分数会被工具缺失主导。
3. **统计分辨率不够。** 44 题、单题全过才计分、每题默认 1 次运行：1 题 = 2.3 个百分点，且没有方差估计。它适合给模型排座次，不适合回答"这次改动有没有让系统变强"。

补充事实：文档只写了如何跑与如何贡献任务/环境，没有第三方 harness 提交入口；榜单上的 6 个都是厂商自带的 coding CLI。Navo 即使接上，也只能表述为"同一任务集与判分器下的自测"。

## 值得吸收的部分

- **任务规格写法**：Intention 只说目标、不复述解法；Require 写可观察行为；Allowed 显式列出等效实现。这正好是 Navo Verification 缺的 rubric 形态——可用于人工确认点与 Node 交付验收的判据模板。
- **失败分列**：环境、执行、证据失败与产品失败分开记录。Harness-Bench 的 `infrastructure_error` 已经踩过这个坑（13 次、11 次重跑恢复），这条应固化成评测报告字段。
- **复现优先于断言**：先用脚本复现再判行为，而不是读 diff 猜结果。

## 验证结果与边界

- 上述"事实"全部来自官网与文档页面；仓库代码、solver config 的真实 schema、容器契约未核实（GitHub 直连失败）。
- 未尝试把 Navo 包成 iBench solver，因此"接入成本高"是成本判断，不是不可行的证明。
- 分数对照只用于说明榜单当前水平，不构成对 Navo 在 iBench 上表现的预测。

## 下一步

不建议接入。若要补 Coding 垂直，前置条件是 [187](187-devlog-harness-bench.md) 里的 F17.1 单目录一次性入口，再加浏览器/截图能力，两者都到位后再评估；在此之前先把 BDD 规格与失败分列两条抄进 Navo 自己的验收模板。

## 替代评测候选（同日续查）

判据：能否给 Navo 已主张的能力打出可与他人比较的分数，以及接入成本是否落在现有 F17 一次性入口与 WSL Docker 之内。

| 基准 | 测什么 | 对 Navo 的价值 | 接入成本 |
|---|---|---|---|
| [Terminal-Bench 4.0](https://www.tbench.ai/) | 容器内终端任务，4.0 统一 8 小时超时、已校准资源、删 8 题修 19 题 | 与 Harness-Bench 同为"容器 + 一次性回合"，F17 入口和镜像可直接复用；有公开榜单与滚动版本 | 低 |
| [PlanBench-XL](https://github.com/JiayuJeff/PlanBench-XL)（EMNLP 2026） | 327 个零售任务、1,665 个工具、真值路径 ≥5 步；阻塞机制注入显式/隐式/语义误导的工具故障 | **唯一直接测"工具路径被阻断后能否改道"的公开基准**，正对 Replanning；GPT-5.4 无阻塞 51.9%，最严阻塞 11.36% | 中：它自己驱动 agent loop，要按 retrieve / call / submit 协议接 |
| [DeepPlanning](https://aclanthology.org/2026.acl-long.335/)（ACL 2026） | 多日行程与多商品购物；主动取信息、局部约束、全局预算优化，约束可验证 | 测"规划不是罗列步骤"，与 Roadmap 的约束求解同构 | 中：数据在 HF（Qwen/DeepPlanning），代码在 `qwen-agent/benchmark/deepplanning` |
| [TheAgentCompany](https://the-agent-company.com/)（NeurIPS 2025 D&B） | 自建的小软件公司环境：内网 web、代码、同事通信；最佳 agent 自主完成 30% | 唯一小时级、跨应用、状态跨步骤的真实长程；按 checkpoint 部分得分 | 高：多服务 compose + 浏览器 |
| τ²-bench | 双控对话 + 用户模拟器，`pass^k` 衡量一致性 | 便宜、快，测可靠性而非能力上限 | 低：适合做回归门禁，不适合当主成绩 |
| GAIA / DeepResearch Bench | 浏览与检索型研究任务，报告由 judge 评分 | 对应 Research Workspace，但依赖浏览器与搜索 API | 暂缓：Navo 无 browser 工具 |

### 官网与公开榜单（2026-10-31 核实）

| 基准 | 官网 | 公开榜单 | 第三方能否提交 |
|---|---|---|---|
| Terminal-Bench 4.0 | <https://www.tbench.ai/> | 有，托管在 Harbor Hub（`hub.harborframework.com`，JS 渲染） | 未核实，Hub 有 `Jobs` / `Organizations`，可能需要账号 |
| PlanBench-XL | <https://planbench-xl.github.io/> | 有 Leaderboard 区块，但页面表格为空、静态 HTML 里没有任何模型行 | 无入口；官网数据未发布，只能引用论文表格 |
| τ-bench 家族（τ²/τ³） | <https://taubench.com/> | 有，按 benchmark 分榜（τ³-Banking 最高 55.2%，τ² 最高 87.9%） | 有 `Submit Results` 流程 |
| TheAgentCompany | <https://the-agent-company.com/> | 无（`/leaderboard` 返回 404，站点是 SPA） | 无 |
| DeepPlanning | 无独立官网（论文 + `qwen-agent` 文档） | 无 | 无 |
| Harness-Bench | <https://www.harness-bench.ai/> | 有 | 无第三方 harness 入口（见 [187](187-devlog-harness-bench.md)） |
| Interaction Bench | <https://ibench.ai/> | 有 | 无第三方 harness 入口 |

同赛道另有稳定公开榜单、但本次未评估的：SWE-bench（`swebench.com`）、OSWorld（`os-world.github.io`）、WebArena（`webarena.dev`）、BFCL（`gorilla.cs.berkeley.edu/leaderboard.html`），四者站点均可访问。

"有榜单"与"能把自己的分数放上去"是两件事：目前只有 τ-bench 有明确的第三方提交流程；Terminal-Bench 依赖 Harbor Hub 的账号体系，未核实；其余都只能表述为"按同一任务集与判分器的自测"。

### τ-bench 家族（同日核实）

谱系：τ-bench（2024，零售 / 航空，双控对话的起点）→ τ²-bench（2025-06，加入电信域与 dual control）→ τ³-bench（2026-03，加 `banking_knowledge` 与全双工语音）→ τ-bench 2.0（2026，加 τ-i18n 六语言与 τ-Entity `intake`）。另有 ττ-bench（hyper-tau，"agent 造 agent"），与本次无关。

| 成员 | 内容 | 对 Navo |
|---|---|---|
| `text-v1`（2.0 文本） | 3 域 × 50 道冻结题 × 6 语言 = 18 cells，1 trial 约 900 次调用 | 单域短对话，测不到 roadmap；适合当 agent loop 的回归门禁 |
| `banking_knowledge`（τ³-Banking） | ~700 文档知识库上的银行客服任务，榜单把 Retrieval 单列一列（alltools / embeddings 等） | **唯一值得接的一项**：检索策略是被显式比较的维度，能对上 F13 |
| `voice-v1` / `voice-v2` / `intake` | 全双工语音、六语言、实体逐字捕获 200+ 题 | 与 Navo 无关，跳过 |

判分由四部分拼成（`src/tau2/evaluator/`）：环境 DB 动作 `evaluator_action`、语句 `evaluator_communicate`、环境状态 `evaluator_env`、自然语言断言 `evaluator_nl_assertions`；2.0 把通信检查从子串匹配换成语义 judge。可靠性指标是 `pass^k`——k 次独立重复全部成功，比 pass@1 更惩罚方差。

接入形态（源码核实）：Python 3.12，`--agent-llm` 默认走 `llm_agent`；自定义 agent 要实现 `HalfDuplexAgent.get_init_state` 与 `generate_next_message`，在 `build_agent` 注册。也就是说 Navo 要写一个 Python 侧的薄适配器把每回合转发给 Navo 的一次性入口，文本模式不需要 Docker 与浏览器。

榜单事实：τ³-Banking 共 27 个模型，Pass^1 榜首 Qwen 3.8 Max 55.2%，Claude Opus 5 48.7%，GPT-5.5 44.6%，GLM-5.2 37.1%，Kimi K3 37.1%——有空间。τ² 1.x 榜首 87.9%，已接近饱和；2.0 换掉了零售与电信各 50 题，分数与 1.x 不可比。

提交规则的关键一条：**standard 提交要求"通用 LLM 走默认 scaffold"**；加 planner、多 Agent、自定义工具或改控制流即算 **custom**，要单列 `submission_type` 并说明改动。Navo 的 Main + Node 编排必然落在 custom 栏，与模型榜不可直接比较。

### τ³-Banking / τ-Knowledge 事实（2026-10-31 核实）

- 出处：Sierra 的 τ-Knowledge（arXiv 2603.04370，2026-03-04），τ-bench 的新域 `banking_knowledge`；榜单称 τ³-Banking。
- 知识库：698 篇文档、21 个产品类目、约 195K tokens；由结构化数据库经五阶段生成非结构化文档（LLM 生成 + 双人独立审计）。
- 任务：文本任务 97 道（`data/tau2/domains/banking_knowledge/tasks.json`）。平均需要 18.6 篇文档、9.5 次工具调用，最多 33 次；每题字段为 `actions` / `communicate_info` / `reward_basis` + `required_documents`，动作带 `requestor`（用户也会操作 = 双控）。
- 三个难点：discoverable tools（工具只在文档里出现，必须先 `unlock` 再 `call`）；flow-based 用户模拟（条件规则在关键节点改道、引入状态变化）；判定只看目标 DB 状态，不看文风。
- 检索配置（`retrieval_toolkits.py`）：`no_knowledge` / `full_kb` / `golden_retrieval` / `bm25` / `qwen_embeddings` / `openai_embeddings` / `grep_only` / `terminal_use` / `terminal_use_write` / `AllTools`（BM25 + dense + 只读 shell）。
- 论文结果：最佳配置 GPT-5.2-high 仅 25.5% pass^1、13.4% pass^4；直接给 gold 文档也只到 39.7% pass^1，说明难点在"读对 + 用对"而不只是检索。terminal 配置在 6 个模型里的 5 个上最好，比向量检索高 2.4–3.6pp。
- 榜单现状：27 个模型，Pass^1 榜首 Qwen 3.8 Max 55.2%（AllTools），与论文数字**不可直接比较**——v1.0.1 修过该域判分（2026-07-15），2.0 又换了任务与配置。
- 对 Navo 的接口：`terminal_use` 就是 shell + grep，Navo 原生具备；discoverable tools 的"先发现再调用"与 F15.1 的 MCP 工具发现同构；检索可整体替换，正好用来对照 F13 的 GraphRAG。

### Terminal-Bench 4.0 事实（2026-10-31 核实）

- 规模：v4.0.0 标签下 `tasks/` 计数 **68 道**；4.0 相对 3.0 删 8 题（饱和 2、拒答 2、公开解法 2、质量/平台 2）、修 19 题，全部任务统一 **8 小时** agent 超时。
- 运行：`harbor run -d terminal-bench/terminal-bench@4.0.0 -a <agent> -m <model> -k 5`；沙箱可选本地 docker / modal / daytona。`-l`（限题数）、`-i`（glob 选入）、`-x`（排除）支持跑子集。
- **数据集含 GPU 任务**（`jax-speedrun-gpu`、`sglang-qwen-burst`、`vllm-deepseek-streaming`、`fp8-rmsnorm-gemm`、`pretrain-shard-corruption` 等），官方跑法用 Modal 的 GPU sandbox，本机 WSL Docker 不满足。
- 自定义 agent：`BaseInstalledAgent`（把 agent CLI 装进任务容器跑）或 `BaseAgent`（loop 留在 Harbor、通过 `BaseEnvironment` 操作容器）。Navo 的 F17 一次性入口对应前者。
- **榜单对社区关闭**：`leaderboard/SUBMIT.md` 明确写 "Community submissions are currently closed for Terminal-Bench 4.0. Only submissions run by the maintainers will be added to the leaderboard at this time."；社区提交还要求全题、每题 ≥5 trials、用 Hub 上传的公开 trial。
- 题目构成：Coq 形式化证明、UEFI bootkit、FP8 GEMM、vLLM/sglang 推理、FreeCAD、VBA 用户窗体、蛋白质/糖链/基因组分析、卫星影像、形式化加密——硬科学与系统工程占多数，且多题需领域专长。

**结论**：可以跑，但不适合当"测 Navo 能力"的评测。理由：① 榜单关闭，只能自测；② 难度断层——Navo 在 Harness-Bench 软工只有 0.502，这里多数题需要领域专长且部分要 GPU，分数会贴在 0 附近、没有区分度；③ 成本高（8h/题 × 68 题，GPU 任务必须上 Modal/Daytona）；④ 与已跑的 Harness-Bench 274 题同属"容器内终端任务"，增量只是更难，不是新维度。

**唯一值得用的方式**：挑 2–3 道无 GPU 依赖的普通题（如 `bun-sourcemap-leak`、`wal-recovery-ordering`、`payments-pipeline-fix`，需查各自 `task.toml` 的 `resources` 确认）做接入 smoke，验证 Navo 能被 Harbor 当作 installed agent 调起。这检验的是"换一个 harness 契约仍然成立"，比分数有价值。

**采用顺序**

1. **Terminal-Bench 4.0** 只跑 2–3 题 smoke，且只选无 GPU 依赖的题。它检验的是"同一个一次性入口在另一套 harness 契约（Harbor installed agent）下是否成立"，属于基础设施验证，不是新能力；榜单对社区关闭，分数只能自测。
2. **PlanBench-XL** 是这次最值得投入的一项：同一批 327 题跑 default 与 blocker 两档，差值就是"环境被阻断后 Navo 能否重规划"的直接证据，也是目前唯一能对外解释 Roadmap 价值的公开口径。
3. **DeepPlanning** 在 PlanBench-XL 之后，补"全局约束优化"这一维；它和 PlanBench-XL 的差别是约束是全局预算而不是工具路径。
4. **τ³-Banking** 作为回归门禁与检索对照：同一模型跑"默认 scaffold / Navo 编排 / Navo 检索"三档，看 `pass^k` 与检索列是否真的改变结果；不进总分排名。
5. **TheAgentCompany** 等有多应用基础设施时再评估；**GAIA / DeepResearch Bench** 等 browser 工具落地后再议。

**关于自建**：若 PlanBench-XL 的 blocker 档已经能区分"会改道"和"不会改道"，就不必自建长程实验。若要在真实 Research 场景测 roadmap 变更（资料被删、约束变化、工具下线），仍需自建 20–30 题注入式实验，指标是恢复率、额外 token 与完成时间，对照组是"静态计划一次跑完"。

**边界**：本表条款来自论文摘要、官方 README 与项目页，均未安装或运行；Terminal-Bench 是滚动版本（4.0 = 2026-08-28），报告必须写明版本；成本未校准，需 smoke 实测。

## 来源

- <https://ibench.ai/>
- <https://ibench.ai/methodology>、<https://ibench.ai/pipeline>、<https://ibench.ai/tasks>、<https://ibench.ai/environments>
- <https://ibench.ai/leaderboard>、<https://ibench.ai/docs/quickstart>、<https://ibench.ai/docs/contribute>
- <https://ibench.ai/tasks/photo-map-panning>
- <https://www.tbench.ai/news/terminal-bench-4-0>、<https://www.tbench.ai/news/announcement-2-0>
- <https://github.com/JiayuJeff/PlanBench-XL>、<https://aclanthology.org/2026.emnlp-main.385/>
- <https://aclanthology.org/2026.acl-long.335/>、<https://github.com/qwenlm/qwen-agent/tree/main/benchmark/deepplanning>
- <https://papers.neurips.cc/paper_files/paper/2025/hash/0d744742f6fac4d1134c019b7cef3c8a-Abstract-Datasets_and_Benchmarks_Track.html>
