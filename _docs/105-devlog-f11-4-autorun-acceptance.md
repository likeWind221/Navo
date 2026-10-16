# F11.4：F11 长程自动化验收

> 日期：2026-10-16  
> 状态：🔄 离线长程场景已实现，等待本机与 CI 验证。  
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

2. **失败 → 重启 → 显式 Resume**
   - Node 首个 Turn 失败；
   - AutoRun 停止为 `turn-failed`，不自动重试；
   - App 重启后没有 AutoRun runtime，也没有新增模型请求；
   - Human 显式 Resume；
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
- 真实模型场景只验证实际 AutoRun 链路，不把模型具体回答当作确定性断言；确定性的 rework / skip / failure / restart 分支由离线脚本完整覆盖。

## 下一步

- 本机执行 `pnpm typecheck` 与 `pnpm test`，重点复验新增 `tests/integration/autorun.spec.ts`。
- 推送当前分支并检查 GitHub Actions 的完整 `verify`。
- 本机与 CI 均通过后再更新本记录为最终验收结果，并进入 F11 收口；真实模型 `scripts/autorun.ts` 单独按需执行。