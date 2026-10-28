# 182：MCP 后端支持规划

日期：2026-10-28。用户授权将 MCP 支持加入后端计划；本次仅文档，无实现或实验。

## 做了什么

新增 Phase 15，按用户获得的能力划分：发现远程工具、按权限执行、AppWorld 端到端验收、使用本地工具。当前下一步由 F14.6 调整为 F15.1，F14 后续待办与前端状态保留。

## 关键决策

MCP tools/list 提供可分页工具名称、描述及 inputSchema，tools/call 提供调用；优先远程 Streamable HTTP 并验证 AppWorld，再补本地 stdio，避免让评测依赖暂时不需要的传输方式。发现目录与模型授权分开，普通 Agent / Main / Node 使用同一工具注册执行边界，可信配置决定各主体可见工具。服务标识与原工具名保留来源，别名处理冲突；活动调用保持确定目标，目录更新影响后续回合。Navo 当前 JSON Schema 子集不能直接接收所有 MCP Schema，实施前必须明确支持范围，不剥除约束后假装兼容。

错误、取消、返回内容及断线按实际含义映射；断开连接不证明远端副作用停止，不自动重发业务调用。进程和连接由客户端生命周期所有者清理。实现预计涉及 MCP 客户端领域模块、Host 装配和可信 Agent Profile 工具选择；具体文件在对应 Step 确认时给出，不写入功能计划。

## 坑与发现

[181](181-devlog-appworld-assessment.md) 原推荐单工具 HTTP 执行方案是当时的最小接入建议。用户本轮选择通用 MCP 方向后，该路线不再作为后续默认实施方案；AppWorld 独占环境、保存、官方判分、版本固定与取消边界仍有效。MCP 服务确实提供工具发现，但不自动完成任务初始化或判分。

本次规划的是 Navo 产品后端客户端，未更改 Codex 或 Claude Code 配置，因此不涉及个人 Agent 配置同步。

## 验证与边界

仅检查文档 diff、状态一致性及相对链接；不运行代码测试、模型或外部服务。所有 Phase15 项标为待实施，后续每步单独授权、分支、PR、完整本机检查与当前 head CI。AppWorld / Flash 真实试运行另外公开成本、调用和停止规则，当前未授权。

## 下一步

确认 F15.1 设计后实施远程服务工具发现；后续按 backend-plan.md 顺序推进。

## 参考

- https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- https://github.com/StonyBrookNLP/appworld/blob/main/guides/evaluating_terminal_agents.md

以上用于确认协议能力；实施时核对并固定实际采用版本，不将该参考版本声明为最新版本。
