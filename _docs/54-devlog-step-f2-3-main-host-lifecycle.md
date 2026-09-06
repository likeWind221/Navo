# F2.3 Main Host 生命周期与传输

## 做了什么

- Electron Main 现在只创建一个 `KernelHostProcess`，启动真实或 Mock Kernel Host，并在应用退出前关闭 RPC 与子进程。
- 新增客户端 stdio NDJSON Transport，直接复用共享 `StreamRpcClient`，向后续 Preload 提供通用流式请求入口。
- 新增 Host 启动配置、就绪检测、stderr 脱敏与大小上限，以及启动失败、崩溃、取消和强制退出保护。
- 增加 3 个测试文件共 9 个测试，并完成 Electron Mock Host 实机启动。

## 关键决策

- Windows 下不直接执行 `pnpm.cmd`；Electron 以 `ELECTRON_RUN_AS_NODE=1` 启动根工程的 `tsx` 和 Host 入口，参数保持数组传递。
- Main 不解释 `AgentTurnEvent`，只按公共 `RpcMethod` 路由流；业务顺序继续由共享 RPC 输出校验器负责。
- 窗口关闭时先结束 Host stdin，让 Server 取消并排空活动请求；超过时限才发送终止信号。

## 坑与发现

- Electron 44 在 Windows 使用 `shell:false` 直接 spawn `.cmd` 会返回 `EINVAL`，且同步 spawn 异常必须转换为 rejected Promise，调用方的 `.catch()` 才能统一处理。
- 命令不存在时 Windows 不保证触发 `exit`；清理等待必须把 `error`、`exit` 和 `close` 收敛成同一个退出事实。
- stderr 可能没有换行且无限增长，因此超限行直接丢弃，避免日志泄密和无界缓冲。
- 参考 `deepseek-harness/packages/core/agent-loop/src/{index,agent}.ts` 的单一 `AbortSignal` 和 dispose 取消语义；当前桌面 MVP 沿用共享 RPC 的 cancel/EOF 传播，未引入 Harness 的 Gateway、Waterfall、多 Carrier 或持久恢复。

## 下一步

进入 F2.4，在 Preload 中建立固定的 `agent.turn` 安全桥和订阅 cleanup，不向 Renderer 暴露原始 RPC method、Node API 或 Host 配置。
