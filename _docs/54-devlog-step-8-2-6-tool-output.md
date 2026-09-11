# 8.2.6 工具结果出口收口

## 做了什么

- `src/tools/types.ts`：`ToolOutput` 由 `string | readonly TextContentBlock[]` 收为**单臂对象** `{ readonly content: string; readonly artifact?: JsonValue }`；`ToolExecutionSuccess` 增加可选 `artifact`。
- `src/tools/service.ts`：`normalizeOutput` 不再判别联合，只校验 `content` 是字符串并归一化为 `[{ type: "text", text }]`；新增局部 `NormalizedOutput`，`successResult` 同时承载 `artifact`。
- 现有 6 个工具对齐到新出口：`read`、`shell`、`fetch`、`search` 各一处，`src/node/tools.ts` 两处；`src/tools/testing.ts` 的 echo/delay 与 `scripts/real.ts` 的 echo 同步。
- 同步更新 `tests/tools/service.spec.ts`、`tests/tools/file/read.spec.ts`、`tests/tools/shell/tool.spec.ts`、`tests/agent/{cancellation,output,resilience}.spec.ts`、`tests/integration/app.spec.ts` 的返回值与断言。

## 关键决策

- **单臂而不是 `string | 对象`**：`ToolOutput` 是协议，多一臂就让每个工具作者多一次「用哪个」的选择；现有工具统一写 `return { content }` 换取全链路零判别。迁移成本随工具数量单调上涨，现在只有 6 个工具，是最便宜的时刻。
- **删除 `TextContentBlock[]` 臂**：该臂是死代码——全部 6 个工具都返回 `string`，唯一跑过它的是一个负例测试。块的边界在下游立刻被拍平（`TurnOutput.toolResult` 直接 join），信息量为零，保留只带来联合判别的成本。
- **`artifact` 只定义协议，未接出**：本步骤不修改 session 事件、RPC 与 `shared/content.ts`。现有工具都还没有结构化结果，`shared/content.ts` 是前后端共享控制面，需要唯一写入者串行提交，因此留给独立子步骤。
- **拒绝「`{content}` 是 `{content, artifact?}` 子类型」的联合写法**：可选属性让前者成为后者的严格子类型，联合成员互相包含时没有任何判别价值，等价于单臂却仍要付单臂的改动成本。

## 坑与发现

- **`scripts/` 不在 `tsconfig.include` 内**：`pnpm typecheck` 不会报 `scripts/real.ts` 的旧返回形态，这类脚本只能靠人工扫描发现，否则会在运行时塌成 `tool-failed`。
- **运行时报错文案随协议一起变更**：`normalizeOutput` 的失败文案由「block must be a text block」改为「must provide string content」，`tests/tools/service.spec.ts` 的负例断言同步更新。
- **数组与对象同为 `object`**：三臂形态下 `typeof x === "object"` 会同时命中数组臂和对象臂，判别顺序写错会读到 `undefined.content`；单臂后该坑消失。

## 下一步

- 进入 **8.2.4 Edit Tool**；`edit`、`write` 直接按单臂出口实现。
- `artifact` 的持久化与投递（session 事件 / RPC / 前端消费）另开子步骤，与前端 Agent 串行；`web_search` 的 `<search-data>` 内联 JSON 到 `artifact` 的迁移同批进行。

## 验证

- `pnpm typecheck` 通过。
- `pnpm test`：40 个测试文件、292 项全部通过。
