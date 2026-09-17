# 67：F9.5b Main Agent `read_node`

## 目标

在 F9.5a `read_roadmap` 的 Project 级只读能力之上，为 Main Agent 增加单 Node 细读 capability。Main Agent 可以根据 Roadmap 中的 Node ID 获取该 Node 当前定义、版本与只读状态，但不能读取 Node 私有 Session、人工 confirmation，也不能跨 Project 猜测 Node ID 获取信息。

## 读取边界

```text
Main Agent
    |
    | read_node(node_id)
    v
ToolService
    |
    | trusted sessionId
    v
requireMainBinding
    |
    v
NodeStore
    |
    +--> Node exists?
    +--> node.projectId == binding.projectId?
    |
    v
Agent Node View
    |
    +--> concise model text
    +--> structured artifact
```

`node_id` 是模型提供的资源选择参数，但 Project 身份不是模型参数。工具必须先由可信 Session 解析 Main Binding，再验证读取到的 Node 属于同一 Project。缺失 Node 与其他 Project 的 Node 对模型使用同一“当前 Project 中不存在”结果，避免跨 Project 信息泄露。

模型可见 Node view 暴露 `id`、`version`、标题、kind、required、只读 status；work Node 额外暴露 goal 与 done_when，control Node 暴露 control purpose。内部 `NodeSnapshot.sessionId` 与 `confirmation` 不进入文本或 artifact。

## 文件变化

- 新增 `src/tools/builtins/roadmap/read-node.ts`：`read_node` Tool、Main Binding 与 Project ownership 校验。
- 扩展 `src/tools/builtins/roadmap/types.ts` / `output.ts`：Agent-visible Node DTO 与稳定投影。
- 修改 `src/tools/builtins/roadmap/plugin.ts`：注册 `read_node`。
- 修改 `src/project/profile.ts`：Main Agent allowlist 和角色说明加入 `read_node`。
- 新增 `tests/tools/roadmap/read-node.spec.ts`：覆盖 work/control 投影、跨 Project 拒绝与 Node Session 越权调用。

## 当前边界

本 Step 仍为纯读取能力，不实现 `write_roadmap`、`modify_roadmap`，不修改 Node lifecycle，也不允许 Main Agent 直接控制 locked / idle / working / completing / skipped。后续 Roadmap mutation 仍需通过独立 capability、版本检查和 Roadmap 领域约束形成新的 Project 事实。
