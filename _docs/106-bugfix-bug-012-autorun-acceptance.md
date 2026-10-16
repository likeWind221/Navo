# BUG-012：AutoRun 真实验收入口与输入不完整

## 现象与复现

2026-10-16 本机验收 PR #70 时发现 `scripts/autorun.ts` 定义 `main()` 后未调用，直接执行只加载声明而不运行验收。补齐入口后，原场景没有提供输入文件或共享 Resource：首个 Node 提交“没有材料”，第二个 Node 请求上游材料后反复等待，不能作为有效的完成证据。

跟踪入口：[Bug 跟踪表](bug-plan.md)。本问题属于 F11.4 尚未合入的验收脚本，随同一 Step 修正，不修改已合入的 AutoRun 生产实现。

## 已证实事实与根因假设

- 缺少 `main()` 调用由源码确认；此前 CI 通过不能证明真实入口执行过。
- 原场景的 Workspace 为空、Resource 列表为空；第二个 Node 的目标要求读取未交接的上游内容。模型输出与 SQLite 现场确认该阻塞。
- 本次不据此判断生产调度的等待策略正确与否，也不扩展生产修复范围。

## 修复内容

- 调用 `main()`，顶层失败设置非零退出码。
- 准备标为虚构的 `2 + 3 = 5` 输入文件，将其注册为 Main 所有、Project 内公开的 Resource；两个 Node 明确读取同一份材料，依赖关系仍要求先完成上游复盘。
- 两个 Node 的验收标准都要求计算结果及来源；最终断言两个 Node 均经 Main 判定 complete。
- 成功和失败均保存每个 Main / Node Turn 的模型请求、工具参数与结果、错误及 Project 状态；复用现有 `captureTurn` 去除 reasoning，不保存凭据。

## 验证结果与边界

- 初始连接失败保留于 `%TEMP%/navo-f114-acceptance-20261016/failure.json`；仅设置 `NODE_USE_ENV_PROXY` 或经 tsx CLI 传递选项的尝试仍失败。
- 使用 Node 24.19.0 直接执行 `node --use-env-proxy --import tsx scripts/autorun.ts` 后，真实请求正常发出。
- 原空输入场景由操作方停止；SQLite 事件现场保留于 `%TEMP%/navo-f114-acceptance-direct-20261016/fixture-blocked.json`。不得算为通过。
- 修正后的本机检查和真实结果见 [105：F11.4 验收记录](105-devlog-f11-4-autorun-acceptance.md)。

## 后续

本机检查与当前 PR head CI 均通过后随 PR #70 收口；F11.3 Electron 与 BUG-010 的既有关闭条件不在本次范围。
