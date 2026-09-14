# F3.2.1.2：工具能力归属收敛

## 做了什么

- `AgentRuntime` 将缺省工具选择统一解析为冻结的空集合；模型请求和工具执行共用这份已解析白名单。
- v1/v2 RPC Handler 不再传递或硬编码 `toolNames`，RPC 请求继续只包含会话、请求和用户文本。
- NodeAgent 等受信任领域入口保留显式能力集合；真实闭环脚本也显式声明测试工具。
- 新增回归场景，证明未授权回合不暴露 Tool Schema，模型即使伪造已注册工具调用也只能得到 `tool-not-allowed`。

## 关键决策

- 缺省语义从“全部已注册工具”改为“无工具”，避免新入口漏传策略时静默扩大权限。
- `ToolService.schemas()` 的通用查询能力保持不变；安全缺省由拥有 Turn 生命周期的 `AgentRuntime` 负责收敛。
- 参考 `deepseek-harness/packages/core/session/src/types.ts:93-98` 的 Agent preset 归属：工具与 prompt 属于会话使用的 Agent 组合，而不是传输请求。当前项目尚未持久化 preset，因此 NodeAgent 继续在执行时生成可信 Profile，普通桌面 Agent 使用内核缺省空能力。

## 坑与发现

- 旧的 `RunTurnInput.toolNames === undefined` 会一路传给 `ToolService`，其通用语义是“不过滤”，所以只删除 Host 的空数组会意外开放全部工具；必须先在 Runtime 内 fail-closed（安全关闭）解析。
- 仅限制发给模型的 Schema 不足以形成权限边界，执行阶段仍需使用同一白名单拒绝模型伪造调用。

## 下一步

- F3.2.2 在不改变工具权限所有权的前提下，将内核已经允许并实际发生的 tool-call、tool-started 和 tool-result 投影到 `agent.turn.v2`。
