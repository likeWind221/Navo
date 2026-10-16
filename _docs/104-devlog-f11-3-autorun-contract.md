# F11.3：AutoRun 全自动推进公共契约

> 日期：2026-10-16  
> 状态：🔄 Kernel Host CI 已通过；前端独立 typecheck/test 与本机 Electron 验证待完成。  
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
- [ ] Frontend typecheck / test；
- [ ] 本机 Electron 实际调用验证。

## 8. 下一阶段

F11.3 完成后进入 F11.4：

> 用多 Node、返工、暂停、失败、重启和最终完成场景进行长程 AutoRun 验收。

F11.4 重点验证“公共契约接入后，真实 Host / Desktop 与 F11.1/F11.2 自动执行内核共同工作”，不再新增 AutoRun 核心状态机。
