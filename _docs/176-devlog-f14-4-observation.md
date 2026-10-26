# F14.4 自动运行持续观察

## 做了什么

新增 `project.autorun.follow.v1`：按项目观察当前 AutoRun 基线、运行身份、目标、自动 Main/Node 的公开回合内容、暂停请求及终态。订阅不启动任务，取消订阅不停止任务；晚订阅提供当前 Session/Turn 身份和后续事件，不伪造过去的 turn-started。正式页面与 Bridge 消费仍属于前端 F8。

## 关键决策

- `autorun.ts` 保有运行状态机，`autorun/observation.ts` 独立拥有监听集合及关闭清理。监听建立时同步给出当前快照、已请求暂停及正在执行的回合身份。
- Host 只投影已有公开 v2 Turn 事件，过滤 CommandEvent；RPC 分别校验项目、运行、目标、会话/回合/请求身份和事件顺序，不能用普通 project.follow 摘要代替回合内容。
- 公开终态到达时同步清除 activeTurn，避免在回合完成与异步收尾间建立的晚订阅误收旧身份。回合 finally 继续清理；Host 关闭会结束观察，取消只解绑监听。
- 沿用既有 resume 语义：从暂停项目状态生成新 runId，重置连续运行的计数与预算，保留项目/路线/Node Session；完成的进程内运行会移除，不承诺跨重启恢复旧 run。

## 坑与发现

- 主编排审查补齐跨项目快照拒绝、运行目标变化顺序、已取消请求和终态晚订阅处理；验证包含暂停请求期间的晚订阅和取消观察后任务继续。
- `src/project/autorun.ts` 实测 369 行，保留原因是同一既有 AutoRun 生命周期与执行决策状态机；监听集合、RPC 校验和 Host 转换已拆到各自所有者，不为行数再增加无语义转发层。

## 验证与边界

- 子 Agent：Node 24 类型检查、3 个相关测试文件 / 25 项和 diff 检查通过；主编排完整与正式 Host 结果见后续补充。
- 本步骤不改变自动执行、暂停/恢复规则，不持久化 AutoRun，不补发订阅前的内容增量，不交付前端控件或历史查询。

## 下一步

完成本机完整、正式 Host 与 PR 当前 head CI 后收口；F8 独立接入，后端下一项为 F14.5 普通会话管理。

## 主编排验证

- Windows / Node24.22.1：类型检查与完整179文件1118项通过，263.98秒；diff检查通过。
- 正式stdio Host、独立SQLite、实际Qwen适配器连接本机受控SSE：基线不启动推理、取消观察不停止任务、A/B项目隔离、晚订阅当前回合与暂停请求、回合边界暂停、新run恢复/计数重置/原Node Session保留、Node提交与Main审查完成、重启不恢复旧run、活动观察期间正常关闭Host通过。
- 最终现场 `%TEMP%/navo-f144-host-exv2oef_`；4次本机受控生成、0外部生成/Embedding。证据为本轮外部 `f144/host.json`、`host-shutdown.log`，上一轮同样通过的现场 `navo-f144-host-rvvb6xrc` 保留。
- 首轮QA把既有start RPC的即时running应答误当最终结果，断言失败；修正脚本按follow的paused/completed终态验收，未修改生产算法。失败证据 `f144/first-failure/` 与现场 `navo-f144-host-1eeh5h0_` 保留。
- 项目/路线由生产createApp构造固定验收夹具，不声称验证Main自主规划质量；真实远程模型、Electron Bridge及正式F8页面未在本步验收。
