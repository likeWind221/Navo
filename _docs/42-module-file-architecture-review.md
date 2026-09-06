# 模块分文件架构审核

**审核基线：** 2026-09-06 当前工作树  
**范围：** `src/**`、`rpc/**`、`frontend/src/**`、`frontend/electron/**`

## 1. 总体结论

当前领域边界总体清晰，不建议以“低于 50 或 100 行”为理由批量合并。入口、协议、错误类型、插件装配和进程边界天然会很短；强行合并反而会模糊依赖方向和所有权。

真正值得改善的是：同一概念被拆成两个总是一起变化的薄文件、通用文件名无法表达具体角色，以及单文件已经承载多个异步状态机。建议先做两个低风险收敛，再观察 RPC 和持久化方向。

## 2. 当前规模

| 模块 | 文件数 | 大致规模 | 判断 |
|---|---:|---:|---|
| `src/brand` | 1 | 64 行 | 保持 |
| `src/session` | 2 | 330 行 | 协议与 Store 分离合理 |
| `src/llm` | 7 | 796 行 | 流协议、组装器、Provider 端口与 Service 清晰 |
| `src/agent` | 7 | 785 行 | request/response/result 对应执行阶段 |
| `src/tools` 核心 | 6 | 约 768 行 | Schema、注册执行、类型与装配职责不同 |
| `src/tools/builtins/search` | 8 | 约 653 行 | 安全分层合理；格式化已收回 `tool.ts` |
| `src/node` | 9 | 962 行 | 领域模型已归并，NodeSession 服务已明确命名 |
| `rpc` | 7 | 约 746 行 | 小协议文件合理；`stream-rpc.ts` 已含多个状态机 |
| `frontend/src` | 8 | 238 行 | 入口与组件边界自然 |
| `frontend/electron` | 2 | 54 行 | main/preload 是安全边界，必须分离 |

行数只用于发现候选点，不作为合并标准。

## 3. 分模块审核

### `brand`、`session`

`brand/ids.ts` 内聚度高，不按 ID 类型拆分。Session 的 `types.ts` 是事件协议，`store.ts` 是提交与 Surface 行为，变化原因不同；持久化出现后应新增 repository/codec，而不是继续拆事件文件。

**决定：保持。**

### `llm`

`adapter.ts` 虽只有一个接口，却明确代表 Provider 端口；`types.ts` 是跨 Provider 数据协议。`collect.ts` 是流消费入口，`assembler.ts` 是有状态块组装器。

**决定：保持。** 六行端口文件不是坏味道；当前并入 `types.ts` 的收益不足以支付导入迁移成本。

### `agent`

`runtime.ts` 负责生命周期，`request.ts`、`response.ts`、`result.ts` 分别处理请求、响应/工具执行和结果构造；`limits.ts` 与 `inbox.ts` 各自拥有状态机制。

**决定：保持。** 合并会形成 300 行以上的流程文件并增加冲突。

### `tools` 核心

`schema.ts` 与 `service.ts` 都接近 270 行，但前者是纯校验/快照边界，后者是 Cordis 注册与执行生命周期。`plugin.ts` 虽短，却是组合根。

**决定：保持。** 不增加只做内部转发的 barrel。

### `search`

`types`、`errors`、`validation`、`execution` 与 Adapter 的分层对应安全检查点；`exa-response.ts` 拥有响应字节预算、Content-Type 与 JSON 映射边界，应独立。

原 `format.ts` 只有 `tool.ts` 一个生产消费者，二者共同定义模型可见输出。

**实施结果：** `formatSearchOutput` 和输出预算已并入 `tool.ts`，9 个文件收敛为 8 个；安全校验和 Adapter 边界保持不变。

### `node`

原 `types.ts` 只定义 Node/Capability/Snapshot，并立即依赖、转发 `content.ts`；两者共同描述当前领域模型。`events.ts`、`projector.ts`、`store.ts` 分别承担历史协议、纯重放和命令/生命周期，必须独立。原 `service.ts` 实际是 NodeSession facade，名称不够具体。

**实施结果：**

- `types.ts + content.ts → model.ts`；
- `service.ts → session-service.ts`；
- 其余 Node 文件保持独立。

这样减少一个薄文件并提升导航语义，不破坏事件存储边界。

### `rpc`

`protocol.ts`、`validation.ts`、`ndjson.ts`、`agent.ts` 分别是帧协议、运行时边界、字节编解码和业务方法契约，不应因短小合并。`stream-rpc.ts` 同时包含 Router、Client、Server 与 AsyncQueue，已达到 325 行并涉及多个状态机。

**建议 C（触发式）：** 下一次增加重连、背压或第二类复杂业务流时，按状态所有权拆分：

```text
rpc/
├─ stream-client.ts   Client + 客户端 AsyncQueue
├─ stream-server.ts   Server + 活动任务收敛
├─ router.ts          方法注册与解析
├─ protocol.ts
├─ validation.ts
├─ ndjson.ts
├─ agent.ts
└─ index.ts           仅公共导出
```

当前可靠性修复期间不立即拆，以免结构调整掩盖行为变化。

### `frontend`

React `main.tsx`、`env.d.ts`、Electron `main.ts` 与 `preload.ts` 都是框架或安全入口，短小是优点。`WorkspaceShell`、`ChatWorkspace`、`Composer` 具有独立布局或状态角色；共享 CSS 在当前规模下比多个微型 CSS 文件更易维护。

**决定：保持。** 设计基线稳定且无需继续对比时，可删除开发专用 `preview/`，不要把样板组件合入正式页面。

## 4. 实施优先级

### 立即或近期

1. 文档统一阶段记录和分文件规则，本次完成。
2. Search 的 `format.ts → tool.ts` 已完成。
3. Node 领域模型合并与 NodeSession Service 重命名已完成。

### 满足条件后

1. RPC 增加重连、背压或更多复杂方法时，再拆 Client/Server/Router。
2. Node 持久化开始时，再增加 repository/codec/migration。
3. 前端真实 Agent 接入后，按状态所有权拆 view-model 与 CSS；当前不预建空目录。
4. 根测试超过约 30 个文件或同领域文件明显增多时，再让测试目录镜像源码模块。

## 5. 后续规则

1. 协议、状态机、安全边界、进程入口有独立所有权，可以独立成文件。
2. 经常一起修改、只有单一消费者且没有独立测试价值的代码优先合并。
3. 拥有队列、缓存、AbortController 或生命周期的代码按状态所有者拆分。
4. 除包的公共出口外，不新增只做 re-export 的微型 barrel。
5. `<40` 行只触发复用/所有权复核；`>250` 行检查是否包含多个状态机；不设硬性上下限。

本仓库适合的原则是：**按职责和状态所有权拆分，用行数发现问题，但不让行数决定架构。**
