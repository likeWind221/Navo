# 158：BUG-032 真实验收 Embedding 端点连接失败

日期：2026-10-26。所属：后端验收 / 外部服务依赖。优先级 P1（阻断原服务路径）。状态：**用户决定搁置，未修复**。跟踪项见 [Bug 表](bug-plan.md)。

## 现象与复现

用户在 BUG-031 修复后另行授权一次真实复验：生成调用最多 48 次、Embedding 最多 20 次、20 分钟，图谱成功后继续两 Node / Main Review，失败停止、不自动重跑。验收分支以 merge 提交 `2835a23` 同步 master `21fec9a`；没有改生产逻辑、前端或服务配置。

Node v24.22.1 / Windows PowerShell 下运行 `pnpm typecheck`、`pnpm test tests/integration/library tests/resource/graph tests/llm/adapters/openai.spec.ts --maxWorkers=4`、`pnpm exec tsx scripts/library.ts --preflight` 均通过；专项 9 文件 / 46 项、15.71 秒，preflight 为零推理。

随后唯一一次 `pnpm exec tsx scripts/library.ts --real` 在 intake 阶段失败，耗时 32420ms。没有重跑。

## 已证实事实与根因假设

- 三份用户资料保存成功，正文全部 `ready`。
- 使用现有默认端点 `http://192.168.99.2:8081/v1`、Qwen3-Embedding-4B；本进程没有 EMBEDDING_BASE_URL 覆盖。
- 3 次单输入 Embedding fetch 尝试的 status 均为 0，未收到 HTTP 响应；耗时分别 10725 / 10739 / 10718ms。maxAttempts=1。不能写成成功 HTTP 或 GPU 推理，也没有足够证据确认远端是否执行过推理。
- 三份 `resource_index_builds` 均为 `failed / request-failed`，消息 `Embedding request failed after the configured attempts.`。
- `graph_builds`、生成账本和 graphRequestIndexes 均为空。生成调用 / 生成 HTTP 请求为 0，Main / Node / Review 未运行；这次不能用于关闭 BUG-031。
- 随后仅做一次不执行推理的 3 秒 TCP 检查，`192.168.99.2:8081` 返回 timeout。

根因置信度：仅确认客户端未收到 Embedding HTTP 响应，以及当前端口 TCP 检查超时。网络路径、主机或服务监听的具体原因未定位；不能断言服务停止、模型故障或代码回归。

## 修复内容

**无修复。** 没有重试推理、启动 / 重启服务、调整模型 / 地址 / 参数、修改代理或远端配置；没有动原始失败库。记录后停止。

## 验证结果与边界

- 新现场：`C:\Users\likeW\AppData\Local\Temp\navo-f136-real-Quk7AE\navo.db`；同目录保留 `intake\`、`workspace\`、`evidence\failure.json`、`requests.json`、`intake.json`。
- 日志：`C:\Users\likeW\AppData\Local\Temp\navo-f136-retest-20261026` 下的 `typecheck.log`、`precheck-tests.log`、`preflight.log`、`real.log`。
- 零推理预检独立目录：`C:\Users\likeW\AppData\Local\Temp\navo-f136-real-sa8Dbg`。
- 旧 BUG-031 失败库 `navo-f136-real-ERHQta` 保留，未在旧库重处理。

离线成功不证明真实图谱、生成模型工具选择、Main Review 或真实重启续接已通过；本次尚未执行到这些步骤。F13.6 保持进行中，Draft PR #100 不合并。

## 后续与关闭条件

先单独定位端点连接失败。涉及启动服务、修改远端持久配置等操作时，按远程规则列出完整命令与影响并取得授权。恢复后重新报预算、取得新的真实运行授权，再验证实际 Embedding 和完整任务；仅 TCP 连通或离线 CI 通过不能关闭本项。

## 2026-10-26：用户决定搁置

用户明确表示“bug32不管了，现在用OpenRouter了”，随后授权 OpenRouter 完整验收。后续不再以恢复原 Qwen 端点作为当前任务前置条件；保留本项未修复和原始失败证据，不勾选关闭。OpenRouter 的新运行及独立超时阻塞见 [160](160-devlog-f13-6-openrouter-acceptance.md) / [BUG-033](161-bugfix-bug-033-openrouter-timeout.md)，不能将新路径成功或失败解释成原端点状态变化。
