# F2.4 Preload 最小安全桥

## 做了什么

- 新增固定的 Agent Turn IPC start、cancel 和 update 通道，Main 不接受 Renderer 自定义 method 或 channel。
- 新增 Main 侧 `AgentTurnController`，管理唯一活动 Turn、Renderer 所有权、取消、迟到更新和安全错误映射。
- Preload 仅向 `window.desktop.agent` 暴露 `startTurn`、`cancelTurn` 和 `onTurnUpdate`，订阅返回 cleanup。
- 新增 Renderer 可见类型与更新解析器，Preload 在投递前再次校验 Agent 事件和桥接错误。

## 关键决策

- Renderer 提供业务 `requestId`，RPC 自己生成并管理协议 `id`，两者不混用。
- Client 取消会立即结束本地 RPC 流，因此 Main 将该控制结果收敛成公开 `cancelled` 业务事件。
- 业务终态一旦发布便优先成立，即使 Host 在随后的 RPC `end` 前退出，也不追加第二个桥接错误。
- 未知异常只暴露固定 `host-unavailable` 信息，避免进程路径、堆栈或凭据进入 Renderer。

## 坑与发现

- IPC 调用者必须和活动 Turn 的 `ownerId` 一致才能取消，窗口销毁也会取消其请求。
- 订阅必须移除注册时的同一个函数引用，否则 React 卸载后会继续收到事件。
- 参考 `deepseek-harness/packages/core/agent-loop/src/{index,agent}.ts` 的单一取消信号、首个终态收敛和迟到输出隔离；当前桥接只支持一个固定 `agent.turn`，未采用 Gateway、Waterfall、多 Carrier、重连或回放。

## 下一步

进入 F2.5，实现 Renderer 对话 reducer 和请求隔离状态机，暂不调整静态消息组件的视觉样式。
