# Exa Search 接入真实 Host

## 做了什么

- `Kernel Host` 读取可选的 `EXA_API_KEY`，配置存在时装配 `ExaSearchAdapter`。
- 真实 Host 的 v1/v2 turn handler 将受信任的 `web_search` 白名单传入 `AgentRuntime`；未配置密钥时仍为空工具集合。
- Electron Host 启动配置把 Exa 密钥加入 stderr 脱敏列表。
- 增加配置、白名单转发和启动脱敏测试。

## 关键决策

密钥只从 Host 进程环境读取，不进入 RPC 输入或 Renderer；Exa 适配器仍由 Tools 根注入，工具 Schema 与执行白名单保持同一名称。没有密钥时不注册可用的搜索 Provider，避免模型看到一个必然失败的工具。

## 坑与发现

此前 `agent.turn.v2` 已能执行工具，但 Host handler 固定传空白名单，因此桌面真实模型无法使用已有 SearchTool。仅在 handler 配置层放开白名单仍不够，必须同时把带密钥的 adapter 注入 `createApp()`。

## 下一步

前端 F3.6 需要在配置 `EXA_API_KEY` 的环境中进行真实桌面搜索验收；本次未调用 Exa 真实网络，也未把搜索结果改造成 Renderer 私有协议。
