# F11.3：AutoRun 全自动推进公共契约

> 日期：2026-10-16  
> 状态：✅ Kernel Host、前端独立检查与本机 Electron bridge 验证通过；2026-10-16 收口见 [108](108-devlog-f11-3-desktop-acceptance.md)，PR #71 的代码 head CI 已通过，收口提交仍按当前 head CI 门禁合并。  
> 基线：F11.2 已合入 `master`。

## 1. 阶段定位

F11.1 建立 AutoRun 自动推进闭环，F11.2 补齐暂停、恢复、预算与失败处理。

F11.3 不重新设计 AutoRun 执行逻辑，而是把已有能力通过稳定的 Host / RPC / Electron 公共契约暴露给桌面：

- Human 可以启动 AutoRun；
- Human 可以暂停 / 恢复 AutoRun；
- 桌面可以查询当前 AutoRun；
- 桌面可以看到运行状态、当前/最后停留目标、Turn 计数和停止原因；
- RPC 方法全部带 `.v1` 版本；
- Host、RPC、Electron bridge 两端均进行严格输入/输出校验。

## 2. RPC 方法

| 方法 | 输入 | 输出 |
|---|---|---|
| `project.autorun.start.v1` | `ProjectRefInput` | `AutoRunSnapshotV1` |
| `project.autorun.pause.v1` | `ProjectRefInput` | `AutoRunSnapshotV1` |
| `project.autorun.resume.v1` | `ProjectRefInput` | `AutoRunSnapshotV1` |
| `project.autorun.get.v1` | `ProjectRefInput` | `AutoRunSnapshotV1 \| null` |

Start / Resume 是**启动控制**而不是长轮询接口：调用后立即返回当前 AutoRun snapshot；实际自动推进继续在 Kernel Host 内运行。

因此：

```text
Desktop
  |
  | project.autorun.start.v1
  v
Kernel Host
  |
  +--> AutoRunService.start()
  |
  +--> immediate snapshot
  |
  +--> background AutoRun continues
```

后续状态读取统一通过 `project.autorun.get.v1`，不创建第二套 AutoRun 状态源。

## 3. Snapshot

公共 snapshot 固定为：

```ts
{
  runId,
  projectId,
  status,
  nodeTurns,
  mainTurns,
  currentTarget,
  reason
}
```

其中：

- `status`：`running | paused | completed`
- `currentTarget)：`null`、`main` 或指定 Node
- `reason)：停止原因；运行中为 `null`
- `nodeTurns / mainTurns)：当前连续 AutoRun budget window 已消耗的 Turn 数

停止原因沿用 F11.2，不由桌面重新解释：

- `roadmap-complete`
- `no-eligible-node`
- `review-escalated`
- `review-undecided`
- `turn-failed`
- `turn-cancelled`
- `turn-interrupted`
- `turn-blocked`
- `node-turn-limit`
- `main-turn-limit`
- `human-paused`
- `project-unavailable`
- `busy`
- `aborted`

## 4. Error Contract

F11.3 将 AutoRun 控制错误作为稳定的 Project failure code 暴露：

- `auto-run-active`
- `auto-run-not-found`
- `auto-run-not-paused`
- `auto-run-unavailable`

Host 继续使用现有 `ProjectError -> RpcError -> desktop failure` 映射链，不在 Electron 层重新定义领域错误。

## 5. Electron Bridge

桌面层新增：

```text
shared project API
      |
      +--> IPC channel
              |
              v
        Electron main handler
              |
              v
          Kernel Host RPC
```

对应 IPC：

- `navo:project:autorun:start`
- `navo:project:autorun:pause`
- `navo:project:autorun:resume`
- `navo:project:autorun:get`

Preload 只负责桥接与解析，不持有 AutoRun 状态。

## 6. 状态边界

F11.3 不新增 Project 的持久化 `mode = manual | auto` 字段。

“人工 / 全自动”仍由控制面解释：

- 没有有效 AutoRun：人工模式；
- AutoRun = `running`：全自动运行；
- AutoRun = `paused`：自动运行已暂停，等待 Human；
- AutoRun = `completed`：本次 AutoRun 已完成。

AutoRun 本身仍然是进程内运行许可，不新增 SQLite 持久化表。

## 7. 验收

- [x] 四个 AutoRun RPC 方法均带 `.v1` 版本；
- [x] Start / Pause / Resume / Get 均使用严格 ProjectRef 输入；
- [x] Snapshot 对状态、Turn 计数、target、reason 严格校验；
- [x] Get 支持不存在时返回 `null`；
- [x] AutoRun 错误映射到稳定 Project failure code；
- [x] Electron IPC / preload / shared API 已接入；
- [x] Start / Resume 不阻塞等待整个 AutoRun；
- [x] Kernel Host typecheck / test（GitHub CI：111 files / 693 tests）
- [x] Frontend typecheck / test / build（139 项测试）；
- [x] 本机 Electron 实际调用验证（正式 preload / IPC 与 Mock Kernel Host，退出码 0）；正式页面 AutoRun 控件与视觉交互未包含在本次验收范围。

## 8. 下一阶段

F11.4 已完成，见 [105](105-devlog-f11-4-autorun-acceptance.md)。F11.3 本次补齐前端独立检查与 Electron 公共契约调用验收；正式页面当前无 AutoRun 控件，不能把本次结果解读为产品交互验收完成。

后端下一步可规划 Phase 12 上下文压缩，须独立介绍、确认，不自动实施。前端 F5.4–F5.8 保持原状态。
