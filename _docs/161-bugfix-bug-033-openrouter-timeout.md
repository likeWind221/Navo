# 161：BUG-033 OpenRouter Embedding 真实验收请求超时

日期：2026-10-26。所属：后端验收 / 外部服务依赖。优先级 P1，状态：**仅排查，未修复**。跟踪项见 [Bug 表](bug-plan.md)，本轮范围和记录见 [160](160-devlog-f13-6-openrouter-acceptance.md)。

## 现象与复现

用户授权使用 OpenRouter 完整验收一次：48 次生成、20 次 Embedding、20 分钟，失败停止。显式 `EMBEDDING_PROVIDER=openrouter` 后执行 `node node_modules/tsx/dist/cli.mjs scripts/library.ts --real`；在 intake 阶段用时 48757ms 后因向量索引未 active 停止，未重跑。

## 已证实事实与根因假设

- 使用 `nvidia/nemotron-3.5-embed-1b:free` / 2048 维；3 份正文全部 ready。
- 3 次单输入 Embedding 请求状态依次为 200 / 0 / 200，耗时 1021 / 15016 / 8232ms；`maxAttempts=1` / `timeoutMs=15000`。
- 第二份资源 `87aff0ed-7827-4c79-9970-49146bd4f5fa` 的索引 failed / request-failed，其余两份 active；status=0 表示客户端没有收到 HTTP 响应，不是服务端返回了 HTTP 0。
- 另外两份图谱均 active，说明本次并未被 BUG-031 的参数拒绝阻断；Main / Node / Review 尚未开始。
- 已确认请求触及本地 15 秒预算；具体外部延迟或网络原因未定位，不能断言模型错误、限流或服务停止。现有证据不足以证明增加超时必定解决。

## 修复内容

**无修复。** 本轮只将验收入口接到已交付的统一 Provider，未修改 Embedding 超时、重试、生产逻辑或远端配置，未自动补跑失败资料，旧失败现场保留。

## 验证结果与边界

- 类型检查与零推理预检通过，完整本地测试结果见 [160](160-devlog-f13-6-openrouter-acceptance.md)。离线通过不能代替完整真实任务。
- 现场 `C:/Users/likeW/AppData/Local/Temp/navo-f136-real-1c6qU9/`；原始证据为 `evidence/failure.json`、`requests.json`、`intake.json` 与 `navo.db`，日志 `%TEMP%/navo-f136-openrouter-20261026/real.log`。
- 两次图谱调用在账本中仍为 started，图谱成功以 SQLite active 状态为证；未把不完整账本写成两项完成请求记录。

## 后续

先确定是否调整验收单次请求预算，再按授权执行新一次真实验收。关闭需实际 Embedding 成功且完整图谱 / 两 Node / Main Review 任务通过；不得仅因部分请求 200 或离线 CI 通过勾选。
