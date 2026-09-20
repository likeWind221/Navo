# 77：F9.6d.2 Resource Lifecycle 与 Access Domain

## 做了什么

F9.6d.2 将 F9.6c 的一次性 Resource Registry 升级为稳定的 Resource 生命周期领域。Resource 不再由目录扫描或任意文件引用决定身份，而由稳定 `ResourceId` 表示，并通过唯一的 `ResourceService` 完成创建、读取、修改、删除、权限变化和历史恢复。

当前 Resource 模型收敛为：

```text
ProjectResource
+-- id
+-- projectId
+-- sourceNodeId
+-- name
+-- description
+-- type
+-- entryRef
+-- access
|   +-- private
|   +-- shared(nodeIds)
|   +-- project
+-- revision
+-- createdAt
+-- updatedAt
```

物理内容位置固定为：

```text
<workspace>/.navo/assets/<resource-id>/<entryRef>
```

创建 Resource 会准备独立的 `<resource-id>/` 根目录，但本 Step 不负责把 Node 产物发布进去；真正的 Agent-facing register/publish 流程留给 F9.6d.3。

## 关键决策

### Resource Service 是唯一写边界

```text
caller
  |
  v
ResourceService
  |
  +-- validation
  +-- optimistic revision
  +-- access policy
  +-- content boundary
  |
  v
private in-memory ResourceStore
  |
  v
append-only Resource events
```

第一版实现曾把 `resourceStore` 挂到 Cordis Context。收口自审后移除这一入口：Store 现在由 `ResourceService` 私有持有，其他领域代码只能通过 `ctx.resources` 改变 Resource。这更符合“领域事实不能被任意动态修改，必须经过 Resource CRUD Service”的最终约束，也为 F10 把内存 Store 换成数据库 Repository 保留稳定上层 API。

### Access 使用判别联合而不是组合字段

不再使用 `visibility + allowedNodeIds`，因为它允许出现 `project + allowedNodeIds` 这种无意义组合。最终只有三种合法状态：

```text
private
  Main + source Node

shared(nodeIds)
  Main + source Node + 指定 work Nodes

project
  Main + Project 全部 work Nodes
```

Main 和 source Node 的读取权是系统规则，不重复写入 `nodeIds`。shared 列表必须非空、无重复、不能包含 source Node，并且每个成员都必须是同 Project work Node。

本 Step 只实现可信领域 Service 的 `setAccess` 与 viewer 过滤；“只有 Main Agent 能调用跨 Node 授权能力”在 F9.6e 的 Agent capability / Binding 边界落实，当前没有向 Node 暴露任何权限修改 Tool。

### 生命周期采用 revision + append-only event

```text
create      revision 1
   |
update      revision 2
   |
setAccess   revision 3
   |
delete      revision 4
```

修改、权限变化和删除都要求 `expectedRevision` 与当前值一致，否则返回 `stale-revision`。语义上没有变化的 update/access 操作不追加事件，也不增加 revision。

删除是领域删除：正常 `get/list` 不再返回 Resource，但 `.navo/assets/<resource-id>/` 不会被自动删除，事件历史和物理内容都保留，后续磁盘 GC 不在本 Step 实现。

### Resource 内容边界独立于 Project Workspace 边界

`entryRef` 只允许 portable relative path。读取入口时先定位固定 Resource root，再 realpath 主入口并验证最终目标仍在该 Resource root 内，因此即使 symlink 仍位于 Project 的 `.navo/assets`，只要它跳到另一个 Resource，也会被拒绝。

### Replay 严格重建生命周期

新 Resource event schema 使用 version 2，包含 Project event sequence 与单 Resource 的 `baseRevision/revision`。Replay 在提交前完整校验 event identity、顺序、生命周期转换、source Node、shared Node、metadata 和 access；任何一步失败都不产生部分恢复。

F9 当前没有数据库和已发布生产状态，因此不保留 F9.6c v1 Resource event 的运行时兼容迁移。F10 持久化从当前稳定 schema 开始。

## DeepSeek Harness 对照

只读参考了 DeepSeek Harness：

- `packages/workspace/workspace/src/types.ts`：Workspace 使用稳定 ID 作为引用锚点，canonical path 可以变化/失效但不能反过来充当身份；Navo Resource 同样以稳定 ResourceId 与物理路径分离；
- `packages/skill/skill/src/index.ts`：Registry/Service 自己拥有 provider 与 catalog，消费者通过 Service API 获取结果，而不是直接操作底层 provider；Navo 借用这一“单一服务边界”原则，但 Resource 不采用 Skill 的动态发现生命周期；
- `packages/api/workspace-files/README.md`：授权上下文和内容读取由 Host/Service 边界决定；Navo 在 Resource 上更严格，除 Project Workspace containment 外再增加 `assets/<resource-id>` containment。

没有复制 DSH 的 Skill provider、动态 catalog、Remote Resource 协议或 workspace-files 的跨 Workspace read 语义。

## 坑与发现

- 初版 replay 冲突测试复制了旧 event id / shared Node，导致更早的严格校验先触发；测试随后拆开每个不变量，确保 duplicate event id、invalid shared Node、duplicate ResourceId 分别命中自己的边界。
- 初版 `ResourceService` 同时承担在线 CRUD、历史解析和校验，超过模块阈值；最终拆为 Service、history、validation、access、projector、path 六个职责模块。
- 拆分时曾遗漏 Cordis `Context.resources` augmentation，以及事件工厂泛型跨 helper 的相关性；均由 typecheck 在运行测试前拦截并修复。
- 最终自审发现公开 `ctx.resourceStore` 会允许绕过 Service 修改事实，因此将 Store 收回为 Service 私有状态。

## 验证

GitHub Actions Windows CI：

```text
pnpm typecheck  PASS
pnpm test       PASS

64 test files
404 tests
404 passed
```

关键场景覆盖：

- Resource 创建后默认为 private，稳定创建 `.navo/assets/<resource-id>/`；
- name/description/type/entryRef 可按 revision 修改，stale revision 被拒绝；
- access 只能是 private、shared(nodeIds)、project；
- source Node、重复 Node、control Node、跨 Project Node 不能进入 shared ACL；
- Main/source/shared/project viewer 的可见性符合规则；
- delete 隐藏领域对象但保留物理内容；
- entryRef、缺失入口和跨 Resource symlink escape 被拒绝；
- archived Project 可读但不能继续 mutation；
- create/update/access/delete event history 可完整 replay 并继续 revision；
- v1 history、非法 lifecycle、duplicate event id、duplicate ResourceId 和非法 shared Node replay 被原子拒绝。

用户已完成本机 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test` 完整验证，结果全部通过；结合最终 head 的 GitHub Windows CI，F9.6d.2 已满足本机 + CI 双重门禁，可以正式收口。

## 下一步

本机与最终 head CI 双重通过后收口 F9.6d.2。唯一下一步是 F9.6d.3 Node Resource 与 Main Communication Capability，把可信 Session Binding 接到 `register_resource`、`fetch_resource` 和 `send_to_main`；本 Step 未新增 Agent Tool、Main grant Tool、Node 自动启动、数据库、Host/RPC 或 frontend 契约。
