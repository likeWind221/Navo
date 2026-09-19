# 74：F9.6c Project Resource Registry

## 1. 目标与边界

F9.6c 只解决一个领域问题：**Workspace 中哪些重要产物成为 Project 可追踪 Resource，以及这些 Resource 如何保留稳定身份、来源与相对引用。**

本 Step 不增加 Agent Tool，不做 Main -> Node handoff，不修改 Host / RPC / frontend，不加入数据库、Context Builder、RAG、embedding 或正文复制。

## 2. 领域模型

新增 `ResourceId` 和 `src/resource`：

```text
ProjectResource
├── id
├── projectId
├── sourceNodeId
├── sequence
├── createdAt
├── title
├── description
├── type
└── ref
```

`ref` 继续使用 F9.6b 的 Project-relative Workspace 引用，例如 `assets/a2a-report.md`。Registry 不保存机器绝对路径，也不复制文件正文。

## 3. ResourceStore

`ResourceStore` 依赖：

```text
ProjectStore
NodeStore
ProjectWorkspaceStore
      |
      v
ResourceStore
```

当前提供：

- `create(input)`
- `get(projectId, resourceId)`
- `listByProject(projectId)`
- `getEvents(projectId)`
- `restore(projectId, history)`

注册形成 append-only `resource-registered` 事实。每个 Project 内使用连续 sequence；ResourceId 是稳定业务身份，EventId 是注册事实身份。

## 4. 注册边界

新 Resource 注册流程：

```text
projectId + sourceNodeId + metadata + ref
        |
        v
active Project ?
        |
        v
source is work Node in same Project ?
        |
        v
Workspace.resolve(projectId, ref)
        |
        v
target currently exists ?
        |
        v
re-check active Project after async filesystem boundary
        |
        v
append resource-registered fact
```

关键约束：

- archived / missing Project 不能注册新 Resource；
- source Node 必须是同 Project work Node；
- control Node 不能作为 Resource 来源；
- ref 的路径逃逸继续由 Project Workspace 层阻止；
- 新注册要求目标当前存在；
- 跨 Project `get(projectId, resourceId)` 即使知道 ResourceId 也会被拒绝。

异步 `Workspace.resolve()` 后再次检查 active Project，避免路径检查期间 Project 被归档后仍提交新的领域事实。

## 5. Replay 语义

Registry history 可在 fresh Store 中恢复。Replay 校验：

- Project 必须存在；
- sequence 必须连续；
- envelope / timestamp / type 合法；
- ResourceId 不重复且不与已有 Project Registry 冲突；
- EventId 在同一 replay history 中不重复；
- source work Node 必须仍属于该 Project；
- metadata 必须有效；
- ref 必须重新通过当前 Workspace containment 校验。

Replay 与新注册有一个刻意区别：

```text
create()
  -> target must exist now

restore()
  -> ref must still be safe
  -> target may currently be missing
```

原因是 Registry 记录“这个 Resource 曾经是什么以及它指向哪里”，不把当前文件是否还存在当成历史事实的一部分。未来 `fetch_resource` 真正读取时仍需再次检查内容可用性与授权。

Restore 在全部历史验证完成后才提交，失败不留下半恢复 Registry。

## 6. 与 DeepSeek Harness 的对照

开发前只读检查了 DeepSeek Harness 当前 client resource model 与 MCP resource runtime。

采用的原则：

- Resource identity / metadata 与大正文内容分离；
- Resource 引用稳定地址，内容按需读取；
- Resource Registry 本身不应承担模型上下文或正文缓存职责。

没有照搬：

- DSH client-side provider / observable stream；
- `dsh-resource://` URL protocol；
- MCP server resource provider；
- UI pin / subscription lifecycle。

这些机制解决的是客户端实时资源和外部 MCP 资源，不是 Navo 当前 Project 内产物 provenance。Navo F9.6c 保留更简单的 Project-local in-memory fact registry。

## 7. NavoApp 装配

当 `NavoAppConfig.workspace` 显式存在时：

```text
ProjectWorkspaceStore
        |
        v
ResourceStore
```

两者一起挂载。未配置 Workspace 时不注册 ResourceStore，因为 F9.6c Resource 的 ref 语义必须依赖 Project Workspace。

本 Step 没有修改 Kernel Host 环境变量、RPC 或前端。

## 8. 自动验收

新增 `tests/resource/store.spec.ts`，覆盖 7 组场景：

1. create / get / listByProject 与 Project 内注册顺序；
2. source Node provenance、ResourceId 稳定身份和不可变快照；
3. cross-Project Node、control Node、archived Project、missing target、非法 metadata 拒绝；
4. 已知其他 Project ResourceId 时 cross-Project lookup 仍拒绝；
5. history 在 fresh Store 中原子恢复并继续 sequence；
6. 非连续 sequence、重复 ResourceId、不存在 Project 的 replay 不产生部分提交；
7. 文件后来删除时 metadata history 仍可恢复，同时 ref 继续由 Workspace 重新验证；
8. 显式 Workspace 配置下 ResourceStore 随完整 `NavoApp` 挂载。

GitHub Actions Windows CI 最终通过：

```text
pnpm typecheck  PASS
pnpm test       PASS

62 test files
397 tests
397 passed
```

开发过程中 CI 先暴露了两类问题并已修复：

- 自动源码拼接误写字面 `\\n`，导致 TypeScript invalid character；
- replay 调用向窄化的 metadata validator 多传身份字段，触发 excess-property 类型错误。

## 9. 本机验证状态

仓库规范要求本机与 CI 双重验证。本次执行环境尝试：

```text
git clone --branch phase9-f9.6c-resource-registry ...
```

但容器 DNS 无法解析 `github.com`，因此无法在本机取得仓库并运行 pnpm。这个失败属于当前执行环境网络限制，不是代码测试失败，但也不能等价写成“本机验证已通过”。

因此当前 Step 状态保持 **🔄**，PR 可以供人工 review，但在本机 clean-clone 验证通过前不标记 ✅。

建议本机执行：

```text
git fetch origin
git switch phase9-f9.6c-resource-registry
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

## 10. 当前边界

完成代码实现后：

```text
Project
├── Roadmap
├── Mailbox
├── Workspace
│   ├── assets/
│   └── nodes/
└── Resource Registry
    ├── stable identity
    ├── provenance
    ├── metadata
    └── Project-relative ref
```

仍未实现：

```text
register_resource Agent Tool       <- F9.6d
fetch_resource Agent Tool          <- F9.6d
report_to_main                     <- F9.6d
Main resource handoff              <- F9.6e
Node resource context              <- F9.6e
full Human-gated integration       <- F9.6f
```

F9.6c 当前等待本机复验与 PR 合并，之后才能进入 F9.6d。
