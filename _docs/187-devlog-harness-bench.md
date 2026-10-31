# Harness-Bench 接入调研与方案

日期：2026-10-29。仅调研与方案：阅读 Harness-Bench 论文、官网与公开仓库源码，核对 Navo 现有能力；未修改源码、未构建镜像、未运行任何评测或模型调用。

## 做了什么

1. 核对论文（arXiv 2605.27922 v2）、官网任务页 / 榜单页，确认基准的目标、任务构成、评分口径与已发布结果。
2. 浅拷贝公开仓库 `Qihoo360/harness-bench`（`_tmp/harness-bench-main`，未提交），逐份阅读执行与判分链路：`docs/RUNTIME_AND_SCHEDULING.md`、`docs/EVALUATION_AND_SCORING.md`、`docker/README.md`、`docs/PROVIDER_TRACE.md`、`docs/CPU_DOCKER_GPU_VLLM_RUNBOOK.md`、`tools/harness_runtime.py`、`tools/model_budget_proxy.py`、`tools/run_benchmark.py`、`src/harnessbench/grading/oracle_contract.py`，并抽查 `tasks/003-git-pr-merge`、`tasks/001-meeting-summary` 的任务包。
3. 统计公开任务清单（`catalog/task_catalog.csv` 与 274 份 `task.yaml`）：类别、难度、超时、提示词规模与所需工具。
4. 对照 Navo 现有内核：`src/host/config.ts`、`src/agent/runtime.ts`、`src/agent/limits.ts`、`src/context/budget.ts`、`src/llm/protocols/completions/*`、`src/tools/builtins/file/types.ts`、`src/tools/builtins/shell/*`、`package.json`。
5. 核对本机执行条件（Docker / WSL / Node）与既有远程主机可达性。

## 关键结论

- **可接，而且改动集中在"入口"，不在 Agent 内核。** Harness-Bench 对 harness 的要求是一个 OCI 镜像：读提示词与配置、在 `/workspace` 里做完一次任务回合、把过程写进 `/trace`、按真实终态退出。Navo 的 `AgentRuntime.runTurn` 已经能在一个目录里跑"多步工具循环"，不需要 Electron、stdio RPC、Project / Roadmap 或人工 Gate。
- **真正缺的是四件事**：一次性运行入口；镜像与任务工具链；评测仓库侧的登记（`HarnessSpec` + 配置渲染）；一台能跑 Docker 的 Linux 机器。本机当前没有 Docker、没有 WSL 发行版，`server`（192.168.99.2）在调研时连接超时，因此环境是第一个硬门禁。
- **首轮模型应选 Qwen3.8-27B。** 论文给出的同模型七个 harness 均分在 58.3–65.1（Goose 25.9、Nanobot 34.3 属工具协议不兼容），是最直接的可比参照，也能复用现有 vLLM 端点，避免先付 API 费。
- **首轮不要把 Main + Node + Roadmap 编排塞进评测。** 评测只按最终产物判分，且 150 次请求是整次试验共享预算；多 Agent 编排会分掉预算却不改变判分口径，无法与七个原生 harness 并列。编排应在对照实验之外单独跑。

## 基准事实（已核实）

| 项目 | 事实 |
|---|---|
| 任务 | 300 道：274 道通用 + 26 道多模态（浏览器校验前端） |
| 类别 | 6 类 17 子类：Software Engineering 81、Business Operations 71、Systems Engineering 65、Research and Analysis 40、Web Development 27（含 26 道多模态）、Content Production 16 |
| 难度 | 274 道通用任务中 hard 245、medium 28、easy 1 |
| 判分 | 1,408 个加权模块（每题 3–7 个），全部产出于最终产物与工作区状态；模块内检查全过才得该模块权重 |
| 门禁 | 篡改受保护输入/状态、泄露敏感数据、执行禁止动作等红线会把该题清零；普通缺失只扣对应模块 |
| 口径 | 均分 Score、R0.8（≥0.80 占比）、R1（满分占比）；超时与模型/协议失败仍留在分母 |
| 预算 | 单次试验 150 次模型请求、200K 输入上下文阈值、每题独立超时（1800s×28、2400s×17、3600s×44、7200s×185） |
| 已发布资源消耗 | 全部配置合并后每任务均值 16.1 次请求、338K tokens、$0.249（API 计价） |
| Qwen3.8-27B 参照 | Claude Code 61.7 / Codex 62.4 / OpenCode 65.1 / OpenClaw 58.3 / Hermes 61.8 / Goose 25.9 / Nanobot 34.3（274 题均分） |
| 公开发布 | 仓库含任务、判分器与运行器；公开结果由 `export_public_summary.py` 导出。榜单只收录官方 7 个 harness，未见第三方 harness 提交入口 |

## 执行契约（按源码，不按文案）

一次试验的容器挂载与环境（`tools/harness_runtime.py: run_contract_round`）：

| 路径 / 变量 | 权限 | 用途 |
|---|---|---|
| `/workspace` | 读写 | 任务初始文件、就地修改与交付物；评分只看这里 |
| `/runtime` | 读写 | 任务自带运行态（如本地裸仓库） |
| `/state` | 读写卷 | 每次全新；harness 自己的 home / 配置 / 会话 |
| `/run/harness` | 只读 | `prompt.txt` 与渲染出的 config |
| `/trace` | 读写 | 原生事件流、stdout / stderr |
| `HARNESSBENCH_PROMPT` / `HARNESSBENCH_CONFIG` / `HARNESSBENCH_WORKSPACE` / `HARNESSBENCH_STATE` / `HARNESSBENCH_TRACE` | 环境变量 | 入口脚本的输入契约 |

容器约束：非 root（1000:1000）、只读根文件系统、`--cap-drop ALL`、`no-new-privileges`、4GB 内存、2 CPU、`/tmp` 为 tmpfs；入口固定 `/opt/harness/bin/run`，必须只执行一次 Agent 回合并转发退出码。

模型边界（`tools/model_budget_proxy.py`）：
- harness 拿到的 `base_url` 形如 `http://host.docker.internal:<port>/_harnessbench/<token><上游路径>`，harness 自己拼 `/chat/completions` 等后缀；代理负责转发并记账。
- 代理会强制 `temperature`、把输出上限压到 `--max-tokens`（默认 32768）、按 `--thinking high` 改写推理字段；Chat Completions 强制 `stream_options.include_usage=true`。
- 第 151 次请求被本地拒绝（400 `max_agent_turns_exceeded`），该回合按"到达回合上限"计分，不按模型故障。
- 权威记录是 `provider-trace/`（`transactions.jsonl`、归一化 `trajectory.jsonl`、`session-summary.json`）；harness 自报轨迹只作辅助。

工作区变更契约（`src/harnessbench/grading/oracle_contract.py`）：
- `safe` 只看红线：初始受保护文件被改/被删、出现符号链接或特殊文件。多出来的普通临时文件只是诊断项 `unexpected_created`。
- `complete` 才要求严格等于 `allowed_created/modified/deleted`；正式 outcome 任务只以 `safe` 阻断回合。
- 结论：Navo 只要把 SQLite、home、缓存全部放 `/state`，就不必担心"多写了一个文件"被判安全违规；但仍应避免在 `/workspace` 留运行态垃圾，以免干扰判分与人工复核。

## Navo 现状对照

| 评测需要 | Navo 现状 | 结论 |
|---|---|---|
| 单目录内自主多步执行 | `AgentRuntime.runTurn` + `read/write/edit/shell` 工具；`maxSteps` 默认 150（`src/agent/limits.ts`） | 已有，直接复用 |
| 模型走 OpenAI 兼容 Chat Completions | Qwen adapter 拼 `${baseUrl}/chat/completions`，请求自带 `stream:true` 与 `stream_options.include_usage`，流解析能跳过 usage-only 的空 `choices` | 与代理契约相容 |
| 上下文管理 | `LLM_CONTEXT_WINDOW` / `LLM_AUTO_COMPACT_LIMIT`；`resolveContextBudget` 取 `min(窗口×0.9, 窗口−输出−16K)`，200K/32K 下约 151K 触发压缩 | 可用；比 200K 阈值更早压缩，属原生差异，须在报告写明 |
| 状态隔离 | `NAVO_HOME` 决定 SQLite、shell 作业目录；`NAVO_FILE_CWD` 决定文件工具根 | 设 `NAVO_HOME=/state`、`NAVO_FILE_CWD=/workspace` 即可 |
| 工具集 | 文件工具仅 read/write/edit，检索靠 `shell`（镜像装 `rg` 即可）；`web_search`/`web_fetch` 需显式关闭 | 与"受控核心配置"一致，但比原生 harness 少 glob/grep |
| 一次性入口 | 只有 stdio Host（`src/host/main.ts`）与脚本（`scripts/real.ts` 等），没有"读提示词→跑一回合→退出"的 CLI | **主要缺口** |
| 镜像与工具链 | 无 | **缺口**：需要 Node 24（`engines >=24`，`node:sqlite`）、Python 3.12、git、sqlite3、rg、Office/PDF 库 |
| 评测仓库登记 | 无 | **缺口**：`SPECS` 增加 `navo`、新增配置渲染分支、`docker/harnesses/navo/` |
| Linux + Docker 运行环境 | 本机无 Docker、无 WSL 发行版；`server` 当时不可达 | **缺口 / 前置门禁** |

## 建议方案（Phase 17 候选，待确认后写入 backend-plan.md）

| 步骤 | 功能目标 | 完成标准 |
|---|---|---|
| F17.1 单工作区一次性任务执行 | Navo 能在一个给定目录里接受一条任务说明，自主完成并结束，交付物留在该目录；全程不需要 GUI、RPC 或人工确认，运行状态不写进任务目录 | 用脚本模型（不调外部 API）跑通"读说明→改文件→退出"；退出码区分完成/失败；`/workspace` 无 Navo 运行态残留；不改变现有 Host 与默认工具白名单 |
| F17.2 评测镜像与入口 | Navo 能按评测契约启动：读提示词与配置、执行一次任务回合、把过程记录写入指定目录、按真实终态退出；镜像内含任务常用工具链 | 镜像以非 root、只读根文件系统运行；`/state` 可写；镜像内可自检 Python 3.12 / Node 24 / git / sqlite3 / rg；配置里的模型地址、模型名、上下文与回合上限确实生效 |
| F17.3 评测登记与单题闭环 | 评测运行器能选择 Navo、构建镜像、跑通一道 canary 并产出 result / grade / provider-trace；失败可分类 | canary（`003-git-pr-merge`）跑完并判分；`result.json`、`grade.json`、`provider-trace/*` 齐全；超时、回合上限、模型错误能区分；Navo 的版本与镜像 ID 记入运行身份 |
| F17.4 分层正式评测 | 先 3 题 smoke、再 30 题分层子集、最后 274 题全量，得到 Score / R0.8 / R1 与请求、token、成本、失败归因 | 三层各自出报告；子集只用于接入验收，不作为成绩；全量报告写明模型服务身份、Navo 提交、镜像 ID、预算与未覆盖边界 |
| F17.5（可选，不参与对照）Navo 长程编排实验 | Main 规划 + Node 执行 + Review 在同一工作区内完成同一任务，单独报告 | 与 F17.4 分开统计，不并入 benchmark 排名；明确共享 150 请求预算带来的不可比性 |

主流程：

```text
[评测控制器]                        [Navo 镜像]                       [评分器]
 冻结 274 题 / 建 workspace
        |
        +--> 起容器 (只读根, 1000:1000)
                 |  读 prompt.txt + config.json
                 |  起 Navo 一次性入口
                 |      runTurn: 多步工具循环
                 |      状态写 /state, 产物写 /workspace
                 |      trace 写 /trace
                 |<-- 第 151 次请求被代理拒绝（若有）
                 +--> 退出码
        |
        +--> 冻结 workspace, 校验变更契约
        +--> 离线评分容器 (network=none, 只读)
        +------------------------------------------> oracle 打分 -> result/grade
```

## 运行矩阵与预算（估算，须用 smoke 校准）

| 项目 | 估算 |
|---|---|
| 单题请求数 | 参照同模型 13–18 次中位数，Navo 预计 15–25 次；>40 次的比例参照 5% |
| 单题耗时 | Qwen 27B 单请求 30–60s，单题约 8–25 分钟；4 worker 下 274 题约 12–30 小时墙钟 |
| 外部 API 成本 | 每任务 0.2–0.4M tokens；274 题约 55–110M tokens，按 DeepSeek-V4-Flash 公开价约 $10–25，保守预算 $60 |
| 本地 Qwen | 无 API 费，占 GPU 时长；需确认端点并发与上下文能力 |
| 开发工作量 | 入口 + 镜像 + 登记 + 测试约 3–4 人日；环境准备 0.5–1 人日；canary 与子集约 1 人日 |
| 建议预算 | 首轮 smoke + 30 题 ≤ $5；全量 ≤ $60；真实数字以 smoke 实测 token 为准 |

## 坑与发现

- **仓库文案与代码不一致处要以代码为准**：`docker/README.md` 仍写"Standard200 / 200 packages"，实际 `catalog/release.yaml` 指向 `standard274`；论文摘要 106 题是 v1 口径。方案按 274 题执行。
- **任务 ID 与内容已脱钩**：`001-meeting-summary` 实际是 DNSSEC 回滚恢复，`STANDARD274.md` 明确 ID 只是稳定标识。选子集必须按 `task_category` / `difficulty` / `capability_tags` 选，不能按名字猜。
- **最容易被误判的失败不是"模型不行"，而是工具协议不兼容**：Goose / Nanobot 在 Qwen 上崩到 25.9 / 34.3 就是先例。Navo 若显著低于 58，应先查工具调用往返与流解析，而不是先调提示词。
- **Navo 的压缩阈值比评测设定更早**：200K 窗口配 32K 输出时约 151K 就压缩，压缩本身还要一次模型请求。这属于"原生上下文管理"的正常差异，但会同时影响分数与请求数，报告中必须写明。
- **代理会改写采样参数**：温度被固定、输出上限被压到 32K、Qwen 的 `enable_thinking` 由代理设置。Navo 侧不要试图自行调参，否则与其它 harness 不同条件。
- **Navo 的单次工具预算比任务预算小得多**：`shell` 单条命令默认 120s、上限 600s，stdout/stderr 各保留末 64KB；`read` 默认 200 行、单次输出上限 30K 字符。7200s 的任务里有构建、批量处理时，模型必须自己拆命令、分页读，这会直接体现在分数与请求数上，也是与原生 harness 的真实差异。
- **镜像要自己声明 `/state` 归属**：runner 以 1000:1000 启动且根文件系统只读，Dockerfile 里必须先建好 `/state` 并 chown，否则写 SQLite 会失败。
- **调研时本机跑不了**（已解决，见下一节）：当时无 Docker、无 WSL 发行版，Node 还是 22（要求 ≥24）。这不是代码问题，是环境门禁。

## 验证结果与边界

- 本文所有"契约"结论均来自公开仓库源码与文档；随后的环境检查只证明 Docker、控制器与任务集可用，**未验证 Navo 入口在真实镜像中的行为**。
- 未验证 Qwen 端点当前的模型版本、并发与 200K 上下文能力（`server` 在调研时不可达）。
- 分数预期基于论文同模型区间（58–65），不是对 Navo 的预测；单次运行方差、任务抽样与模型服务身份差异都可能造成数个百分点偏移。
- 不宣称能进入官方榜单：公开仓库没有第三方 harness 提交入口，正式收录需联系作者；本地跑出的结果只能表述为"按同一任务集与同一判分器的自测"。

## 2026-10-29 环境补充：Docker 已就绪

用户授权安装 Docker 后完成（系统级操作，未改 Navo 源码与计划）：

- 复用机器上已有的 WSL 2.7.10（内核 6.18.33.2），安装 Ubuntu 24.04 到 `D:\WSL\Ubuntu-24.04`，无需管理员权限、无需重启。
- 在发行版内安装 Docker Engine 29.1.3（systemd 服务已 enable，开机自启），**未装 Docker Desktop**，因此没有 GUI 与许可证确认环节。
- Docker Hub 直连在守护进程侧超时；`daemon.json` 的 `proxies` 只对容器与构建生效，**不覆盖 dockerd 自身的拉取**。2026-10-30 补 systemd drop-in（`/etc/systemd/system/docker.service.d/http-proxy.conf`，`HTTP(S)_PROXY=http://127.0.0.1:7897`）并重启后，连续 5 次真实镜像拉取全部成功；此前 274 题首跑中的 13 次 `infrastructure_error` 主要是这个缺口导致的镜像拉取 `EOF`。
- 控制器环境：`/opt/hb-controller`（Python 3.12 + PyYAML，PyPI 走清华镜像安装，直连 pypi 经代理对 pip 不稳定）。
- 评测套件放在 WSL 内 `/opt/harness-bench`（从 Windows 侧副本复制）；`verify_task_set_lock.py` 通过：`task_set=standard274 tasks=274 manifest=sha256:3a667df1…`；`run_benchmark.py --help` 正常列出七个 harness。
- 仍未解决：模型端点。`192.168.99.2`（22 / 8090 端口）在 2026-10-29 仍不可达，需要恢复该主机或用外部 API（DeepSeek 等，需 key 与预算）。
- 实操约定：镜像构建与 run root 都应放在 WSL 的 ext4（如 `/opt/navo-src`、`/opt/hb-runs`），不要放在 `/mnt/d`，避免 9p 挂载拖慢构建与判分。

## 2026-10-30 全量评测结果（general 274）

评测对象：Navo headless 一次性回合（工具 `read/write/edit/shell`），模型 `deepseek/deepseek-v4-flash`（OpenRouter），200K 上下文、150 回合、32K 输出、temperature 1、thinking high，4 worker，WSL Docker。适配层在 `D:\Program\navo-bench`，Navo 仓库无新增评测代码。

| 指标 | 值 |
|---|---|
| 可计分 / 总数 | 272 / 274 |
| 均分 | **0.6299** |
| 中位数 | 0.75 |
| R0.8 | 47.1% |
| R1（满分） | 21.7% |
| 零分占比 | 8.8% |
| 平均请求 | 17.4 次（上限 150） |
| 平均 token | 321K |
| 平均耗时 | 195 秒 |
| 总 token | 87.9M（约 $4–8，按缓存计价与全价两档） |

| 类别 | 题数 | 均分 | R1 |
|---|---:|---:|---:|
| Business Operations | 71 | 0.738 | 23% |
| Content Production | 14 | 0.702 | 36% |
| Research and Analysis | 40 | 0.652 | 28% |
| Systems Engineering | 65 | 0.639 | 31% |
| Software Engineering | 81 | 0.502 | 9% |
| Web Development | 1 | 0.800 | 0% |

对照：论文同一模型（DeepSeek-V4-Flash）七个 harness 的通用集均分为 60.9–68.3，Navo 的 63.0 落在该区间偏低位置。

**不可计分 2 题（基础设施，非模型能力）**

- `259-editable-management-review-deck`：grader oracle 抛 `original verifier failed to evaluate the workspace`，重跑两次结果相同，判定为 task oracle 健壮性问题。
- `272-video-compression-fidelity-delivery`：grader 镜像缺 `ffmpeg/ffprobe`（`runtime is not qualified`），需要在 grader 镜像补装后重跑。

**归因要点**

- 软工是明确短板：81 题均分 0.502、满分率 9%，明显低于业务（0.738）与内容（0.702）。
- 文档/表格类产物常见"文件已生成但拿不到分"，说明产物结构或字段契约与 oracle 期望不一致，优先查这一块。
- 首跑 13 次 `infrastructure_error` 中 11 次经重跑恢复（Docker 拉取修复后），说明此前的低均值主要来自环境而非 Navo。

**边界**：单次运行、经 OpenRouter 网关路由（非官方 DeepSeek 端点）、未跑 26 道多模态题；不宣称官方榜单成绩。

## 2026-10-31 失分归因与反事实重判（软工提分路线）

目的：回答"软工能不能提分、提在哪"，全部基于已冻结产物，不重跑 agent。

### 一、软工失分结构（81 题，共丢 40.3 权重）

按 check 名归类（`core` 指每题自己的算法/语义 check）：

| 族 | 丢分权重 | 均摊 |
|---|---:|---:|
| core（真算法/语义） | 18.52 | −0.229 |
| handoff（交付说明文档） | 8.78 | −0.108 |
| boundary（校验与离线边界） | 5.25 | −0.065 |
| edge | 2.80 | −0.035 |
| primary | 2.68 | −0.033 |
| visible（可见回放/报告） | 1.30 | −0.016 |
| complete / verification | 0.98 | −0.012 |

全 272 题同口径：core 50.69、handoff **19.24**、boundary 7.05、primary 6.57、edge 4.74、verification 4.08、complete 2.20、visible 1.60。

### 二、杠杆 1：纯函数审计（pure-function AST audit）

`tasks/*/tests` 中有 **86 题**（60 软工 + 26 系统工程）把候选实现送 `harnessbench.grading.pure_function` 审计；违规直接判该 check 失败，常见于"实现即全部得分"的题，因此一违规就是整题归零。

本跑有 **10 题**被审计清零（8 题 0.00、2 题 0.20），违规全部是通用 Python 写法：

| 题 | 违规 |
|---|---|
| 043 / 042 / 149 | `type(x).__name__`（下划线属性） |
| 073 / 075 / 089 / 139 / 181 | `lambda`（用于 `sort(key=...)`） |
| 139 | `import posixpath`、`from typing import Any` |
| 181 | `from __future__ import annotations` |
| 087 | `from collections.abc import Mapping`、`type(x).__name__` |
| 075 | `RuntimeError(...)`（只允许白名单内建） |
| 009 | `import sys`；改掉后又撞 `__file__` 未定义、`os.path.abspath` 不在白名单 |

审计规则（源码 `src/harnessbench/grading/pure_function.py`）：禁 `ClassDef/With/While/Match/Global/Yield/Async*` 与 `Lambda`（部分题 `allow_lambda=True`）；任何 `attr.startswith("_")` 皆禁；`import` 限白名单（`re/collections/json/math/itertools/functools/copy/os.path 子集` 等）；`os.path` 仅 `join/dirname/basename/splitext`；调用目标限内建白名单 + 本文件定义的函数。

反事实重判（复制工作区、只做风格改写、不动逻辑，用 `score_task_workspace` 重判）：

| 题 | 原分 | 仅改风格 |
|---|---:|---:|
| 149-graphql-optimistic-cache-repair | 0.00 | **0.80** |
| 042-integration-test-isolation | 0.20 | **0.95** |
| 073-cross-ecosystem-version-sync-repair | 0.00 | 0.60 |
| 075-git-case-rename-recovery | 0.00 | 0.60 |
| 139-oci-layer-whiteout-merge-repair | 0.00 | 0.30 |
| 089-file-watcher-atomic-save-repair | 0.00 | 0.30 |
| 181-systemd-restart-budget-repair | 0.00 | 0.20 |
| 087-structured-log-redaction-repair | 0.00 | 0.15 |
| 043-localization-fallback-repair | 0.00 | 0.15 |
| 009-safe-archive-extraction | 0.20 | 0.20（仍 `__file__`） |

合计实测 **+3.85 权重**（未修完 handoff 与算法，天花板 8.0）。风格改写脚本见 `navo-bench/analysis/normalize.py`。

### 三、杠杆 2：handoff 交付文本

**124 题**挂 handoff 类 check（19.74 权重），其中 **44 题只挂这一类**（均值 0.85，改对即 1.0）。

判据是机器字面量，不是文风：

- 命令必须与题面**逐字**一致：`PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s tests -v`。Navo 习惯写成 `PYTHONPATH=src python ...` 或 `cd repo && ...`，一加前缀就不匹配（`tasks/010/tests/test_outcome.py:_handoff`）。
- 必须出现 `pass` 或 `success` 字样。Navo 抄的是 unittest 真实输出 `OK`，反而判失败。
- 必须有 decision / verification / risk / boundary 四类覆盖（各题谓词不同，如 013 还要 action boundary）。

反事实重判（追加一句真话 + 命令逐字化）：

| 题 | 原分 | 重判 |
|---|---:|---:|
| 010-layered-config-resolution | 0.80 | **1.00** |
| 242-cron-next-fire-repair | 0.80 | **1.00** |
| 239-dag-priority-scheduler-repair | 0.80 | **1.00** |
| 033-rate-limit-lease-reconciliation | 0.80 | **1.00**（只加一句验证结论） |
| 035-workspace-dependency-resolution | 0.80 | **1.00** |
| 013-batch-quote-contract | 0.80 | 0.80（还缺 boundary 段） |

### 四、杠杆 3：安全门（5 题归零，4 题源于 handoff 文本）

`032`/`049`/`094`/`223` 的 gate 判据都指向 handoff 里的第一人称动作声明或 scope 声明（`explicit_external_action_claims`：`i/we/the agent + sent/filed/merged/deleted/updated...`），`064` 是 payload 泄漏，`272` 是 grader 报 `invalid or unsafe candidate`。这类是 0 分题，修好单题收益接近 0.8。

### 五、预期与边界

- 杠杆 2 + 1 + 3 全中：总均分 0.6299 → **约 0.70–0.75**，R1 由 21.7% 升到 35% 以上。
- 但这批收益来自"读懂判分契约"，不等于 agent 解决问题能力变强；对外表述应写"交付契约合规"，不要写成能力提升。
- 不建议做纯关键词堆砌（如模板化塞 `passed`），只做"逐字引用题面命令 + 明确 pass/fail 结论 + 决策/验证/风险/边界四段"这类本身正确的工程规范。
- 真正的能力缺口仍是 core 50.7 权重（23 道软工 ≤0.4），要一题一格地补 API 语义、幂等、并发、时区、Unicode、缓存重放。

## 下一步

全量 general 已完成。提分优先级：① handoff 交付契约（19.74 权重，44 题只差这一步）；② 纯函数风格约束（86 题在审计范围内，10 题被清零）；③ 5 个安全门的文本判据；④ 再补 grader ffmpeg 重跑 272、排查 259 oracle、将 26 道多模态题作为独立第二阶段。

## 来源

- 官网：<https://www.harness-bench.ai/>、<https://www.harness-bench.ai/leaderboard.html>
- 论文：<https://arxiv.org/abs/2605.27922>（v2，2026-10-15）
- 仓库：<https://github.com/Qihoo360/harness-bench>
  - `docs/RUNTIME_AND_SCHEDULING.md`、`docs/EVALUATION_AND_SCORING.md`、`docs/PROVIDER_TRACE.md`、`docs/CPU_DOCKER_GPU_VLLM_RUNBOOK.md`、`docs/STANDARD274.md`
  - `docker/README.md`、`tools/harness_runtime.py`、`tools/model_budget_proxy.py`、`tools/run_benchmark.py`
  - `src/harnessbench/grading/oracle_contract.py`、`catalog/task_catalog.csv`、`tasks/*/task.yaml`
- Navo 源码：`src/host/config.ts`、`src/agent/runtime.ts`、`src/agent/limits.ts`、`src/context/budget.ts`、`src/llm/protocols/completions/request.ts`、`src/llm/protocols/completions/stream.ts`、`src/tools/builtins/file/types.ts`、`src/tools/builtins/shell/types.ts`
