# 66：F9.5a Main Agent `read_roadmap`

## 目标

为 Main Agent 增加只读 Roadmap capability，使其可以在不暴露 Node 私有 Session / confirmation 信息的前提下读取当前 Project 的规划结构，为后续 `write_roadmap`、`modify_roadmap` 和可能的 `read_node` 建立统一读取协议。

## 本次实现

```text
Main Agent
    |
    | read_roadmap()
    v
ToolService
    |
    | trusted sessionId
    v
requireMainBinding
    |
    v
RoadmapStore + NodeStore
    |
    v
Agent Roadmap View
    |
    +--> concise model text
    +--> structured artifact
```

Roadmap tools 作为 Navo 内置工具放在 `src/tools/builtins/roadmap/`。工具全局注册，但仅加入 Main Agent Profile 的 allowlist；工具体内部再次调用 `requireMainBinding`，因此 Node Session 即使绕过 Profile 直接 dispatch 也会被拒绝。

模型可见输出使用 `version` 作为 Agent API 名称，内部 RoadmapStore 仍保留 `revision`。已有 Roadmap 按拓扑顺序展示 Node，并只暴露：Node ID、标题、required、只读 status、直接 `depends_on`、任务描述和完成标准。依赖关系额外以 `A -> B` 的简单文本图展示。`sessionId`、confirmation、Project 内部 revision 等信息不进入模型视图。

空 Roadmap 不是错误，返回：

```text
Roadmap is empty.
No roadmap has been created for this Project.
```

结构化 artifact 对应 `{ state: "empty" }`；已有 Roadmap 返回 `{ state: "ready", version, nodes }`，供测试和后续 Host/UI 复用。

## Harness 对照

本 Step 只读参考 DeepSeek Harness `packages/extensions/cordis-host-runner/src/guard.ts` 的 tool registration boundary：Harness 将 `defineTool/registerTool` 作为模型可见 schema 与宿主可信执行面的边界，并在宿主侧规范化参数和限制上下文访问。

Navo 采用相同的核心原则：Tool schema 只描述 capability，实际 Project 身份不由模型参数提供，而由 AgentRuntime 注入的 Session identity 和 F9.4 Binding 推导。不同点是 Navo 没有复用 Harness 的 sandbox host runner；Roadmap 读取直接接入 Navo 自己的 Project/Roadmap domain services。

## 文件变化

- 新增 `src/tools/builtins/roadmap/types.ts`：Agent-visible Roadmap DTO。
- 新增 `src/tools/builtins/roadmap/output.ts`：领域状态到 Agent view、文本和 artifact 的投影。
- 新增 `src/tools/builtins/roadmap/read.ts`：`read_roadmap` Tool 与 Main Binding 校验。
- 新增 `src/tools/builtins/roadmap/plugin.ts`：Roadmap built-in tools 装配入口。
- 修改 `src/project/profile.ts`：仅 Main Agent allowlist 增加 `read_roadmap`。
- 修改 `src/app.ts`：RoadmapStore 后挂载 Roadmap tools。
- 新增 `tests/tools/roadmap/read.spec.ts`：覆盖 empty、已有 DAG、Node Session 越权调用。
- 修改 `tests/project/session.spec.ts`：测试环境注册新的 Main capability。

## 当前边界

本 Step 不实现 `read_node`、`write_roadmap`、`modify_roadmap`，也不提供任何 Node lifecycle 写操作。Main Agent 只能观察 status，不能控制 `locked / idle / working / completing / skipped`。

当前云端环境仍未执行本地 `pnpm typecheck` / `pnpm test`，因此 F9.5a 保持待本地验证状态。
