# F11.4：F11 长程自动化验收

> 日期：2026-10-16
> 状态：✅ 本机离线、真实模型与代码 head CI 已通过；收口文档提交仍按当前 head CI 门禁合并。
> 基线：F11.3 `5f6112c`；开发分支 `phase11-f11.4-longterm-acceptance`。

## 做了什么

F11.4 不新增 AutoRun 生产状态机，而是把 F11.1、F11.2 与 F11.3 的能力放进持久化 Project 生命周期中进行长程验收。

新增两类离线场景：

1. **暂停 → 重启 → 显式 Start → 完成**
   - Node A 提交；
   - Human 在 Turn 边界请求暂停；
   - App 重启后验证 Project / Roadmap / Node / Session 持久状态不变；
   - 确认重启不会自动恢复 AutoRun；
   - Human 显式 Start，重新建立 AutoRun；
   - Main 对 A 返工，A 使用原 Session 再次提交；
   - Main 完成 A；
   - Node B 提交后由 Main skip；
   - 最终 AutoRun 以 `roadmap-complete` 完成。

2. **失败 → 重启 → 显式 Start**
   - Node 首个 Turn 失败；
   - AutoRun 停止为 `turn-failed`，不自动重试；
   - App 重启后没有 AutoRun runtime，也没有新增模型请求；
   - Human 显式 Start，重新建立 AutoRun；
   - Node 使用已绑定 Session 继续，最终由 Main 完成。

同时新增真实模型验收入口 `scripts/autorun.ts`，复用现有 acceptance 配置与 evidence 落盘机制；真实运行失败时保存 `failure.json` 与当前 Project 状态。

## 关键决策

长程验收关注的是**事实能否跨运行边界保持一致**，而不是重复测试 AutoRun 单元状态机。

~~~text
Human-approved Goal + Roadmap
          |
          v
      AutoRun
          |
     +----+----+
     |         |
   Node A    Main Review
     |         |
     +----<rework
          |
       Node B
          |
       Main Review
          |
          v
   roadmap-complete

Pause / Failure
       |
       v
   App Restart
       |
       +--> durable Project state restored
       |
       +--> AutoRun runtime absent
       |
       v
Human Start
       |
       v
start a new AutoRun from current domain state
~~~

离线场景使用真实 SQLite 文件，并在同一个数据库文件上重新创建 App；不引入新的 AutoRun 持久化表。这样可以直接验证 F11.2 “重启不自动恢复”的边界。

## 坑与发现

- F11.4 不应通过修改 `AutoRunService` 的预算配置来制造短测试，否则会把测试专用配置扩散到生产 App 配置；暂停场景使用 Human pause，预算边界继续由 F11.2 专项测试覆盖。
- 重启前后比较的是 Project、Workspace、Roadmap、Node、Session 等持久事实；AutoRun snapshot 本身不参与比较，因为它本来就是进程内运行许可。
- 发现：`resume()` 只操作当前进程中仍存在的 paused AutoRun；重启后旧 AutoRun 已不存在，符合 F11.0/F11.2 “重新建立 AutoRun” 的设计，因此恢复入口应是 Human 显式 `start()`，而不是跨重启调用 `resume()`。
- Mock 场景中 `submit_completion` 是 Node Turn 的终止工具，因此工具调用后不再额外安排模型请求；`submit_review` 则允许 Main 在记录决定后继续总结，所以 fixture 为“tool call → text”。这一区分避免重启后的请求序列错位。
- 真实模型场景只验证实际 AutoRun 链路，不把模型具体回答当作确定性断言；确定性的 rework / skip / failure / restart 分支由离线脚本完整覆盖。

## 下一步

- 修正后代码 head `17ee6e3` 的 CI `verify` 已通过（[运行 38904406198](https://github.com/likeWind221/Navo/actions/runs/38904406198)，1 分 29 秒）；本机和真实模型验收均通过。F11.4 完成，交付走 [PR #70](https://github.com/likeWind221/Navo/pull/70)，收口文档提交仍待当前 head CI 通过后才合并。
- F11.3 前端独立验证继续保持原状态，本次不把后端场景通过等同于 Electron 验收。

## 2026-10-16 本机验收

环境：Windows / Node 24.19.0。用户授权同步 F11.4 分支并完成验收；本次只修正验收入口、输入与证据，不修改 AutoRun 生产逻辑。问题登记为 [BUG-012](106-bugfix-bug-012-autorun-acceptance.md)。

本机默认 `node` 为 22.23.1，低于仓库要求，检查时使用 Codex 随附的 Node 24.19.0。本机 pnpm 10.33.0 启动 `test` 时停留在包管理器进程；另一 bundled pnpm 尝试重整依赖并因无 TTY 拒绝，未修改依赖。最终直接运行 package scripts 指向的本地 TypeScript / Vitest 入口：

~~~text
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --maxWorkers=4
node --use-env-proxy --import tsx scripts/autorun.ts
~~~

- 类型检查通过。
- 首轮完整测试 694/695 通过：既有 `tests/tools/fetch/network.spec.ts` 的 pinned HTTP 场景在 5 秒处超时；单独复验该文件 7/7 通过。未修改断言或超时；限制 4 个 worker 后完整套件 112 文件、695 测试通过。脚本最终修正后再跑同一完整检查，695/695 通过（50.10 秒）。该证据不证明最初超时的根因。
- 初始真实运行因 transport 失败暂停，随后显式代理直连脚本成功发出请求；空材料场景不能完成，已保留现场并结束。失败情况没有改写成通过，详见 BUG-012。
- 修正后真实模型 `gpt-6-sol` 通过：2 个 Node Turn、2 个 Main Review、4 份 Turn evidence、11 次模型请求、0 个记录错误；两个 Node 都读取共享的虚构输入并获 Main `complete` 判定，最终 `status=completed`、`reason=roadmap-complete`。
- 成功证据：`C:/Users/likeW/AppData/Local/Temp/navo-f114-acceptance-final-20261016/result.json`。内容包括模型请求、工具参数/结果、错误与 Project 状态；不包含凭据，复用现有机制去除 reasoning。
- 离线证明暂停/失败/重启/显式 Start/返工/依赖/skip；真实模型证明给定批准计划和有效共享材料后的自动完成链路。真实场景没有覆盖重启、返工、skip、桌面 UI 或上下文压缩。

本次新增的 `main()` 顶层调用保证脚本实际执行且失败非零退出；`evidence()` 收集 Main 与所有已绑定 Node Session 的 Turn，再复用 `captureTurn` 输出诊断记录。创建输入后以 Main 发布并公开 Resource，两个节点各自取材；不把领域硬依赖理解成自动转发上游私有内容。临时数据库和工作目录由脚本 finally 清理，证据单独保留。因原空材料运行由操作方结束，其临时现场另行保留用于诊断。
