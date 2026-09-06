# F2.5 Renderer 对话状态内核

## 做了什么

- 新增纯函数 `conversationReducer`，管理用户消息、助手占位、活动 Turn、正文 delta 和所有业务终态。
- 新增 `useAgentConversation`，负责固定本地会话、请求 ID、Bridge 订阅、开始、取消和卸载清理。
- 按当前 `requestId` 过滤迟到更新，同时只允许一个活动 Turn。
- 增加状态机测试，当前前端共 7 个测试文件、27 项测试通过。

## 关键决策

- 一次提交原子加入用户消息与空助手消息，避免首个 delta 到达前没有稳定渲染目标。
- `started` 记录 Host `turnId`，首个 `text-delta` 将助手状态切为 `streaming`。
- `completed`、`cancelled`、`failed` 和 `truncated` 都清除活动 Turn，并保留已经生成的正文。
- Bridge 或 start/cancel 命令失败只影响当前请求；聊天状态仅保留稳定 `code/message`，不保存扩展 details。

## 坑与发现

- React render 尚未提交时也可能连续触发发送，因此 Hook 使用同步 ref 执行互斥，reducer 再维护可渲染的活动状态。
- 取消命令可能和自然终态竞争；只有 ref 仍指向同一请求时才允许命令失败覆盖状态。
- 参考 `deepseek-harness/packages/core/agent-loop/src/{index,agent}.ts` 的单活动执行、统一取消、流式前缀保留和迟到输出隔离；当前 Renderer 内核只管理本地单会话文本，不采用队列、回放、持久化或多会话调度。

## 下一步

进入 F2.6，将现有 Composer 与 MessageList 接到 `useAgentConversation`，展示等待、流式、停止及明确终态。
