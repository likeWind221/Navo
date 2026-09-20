# 78：F9.6d.3 Resource Ownership 与 Main Communication Capability

## 做了什么

F9.6d.3 把 F9.6d.2 的 Resource 领域能力正式接到 Project Agent，并根据设计复审把 Resource provenance 从 Node-only `sourceNodeId` 泛化为：

```text
owner
  = Main
  | Node(nodeId)
```

最终权限分成两条正交规则：

```text
Ownership
= 谁可以 CRUD 这个 Resource

Access
= 哪些非 owner 可以 Read
```

Main 与 Node 都可以通过 `register_resource` 发布自己拥有的 Resource。owner 可以 `fetch_resource`、`update_resource` metadata、`delete_resource`；其他 Node 即使通过 `shared/project` 获得访问也只有 Read。Main 默认可读所有 Project Resource，并且是唯一能改变 access 的主体，但 Main 不能借协调身份 update/delete Node-owned Resource。

Node 另获得 `send_to_main(message)`，只向现有 Mailbox 追加 Node→Main 文本事实，不新增 Report/Directive 领域，也不触发 Main、Node、Roadmap 或 completion。

## 关键决策

### Resource owner 由可信 Session Binding 决定

模型参数不接受 `projectId`、`owner`、`nodeId`。Tool 使用：

```text
execution.sessionId
  -> requireAgentBinding()
  -> projectId + Main/Node identity
  -> ResourcePrincipal
```

这沿用已有 Roadmap Tool 的可信身份边界，也借鉴 DeepSeek Harness `packages/skill/tool-skill/src/index.ts` 的 scope 机制：模型只提交真正需要选择的参数，调用者作用域来自执行上下文，不由模型自报身份。

### 发布文件采用稳定快照

`register_resource(path, name, description, type)` 只接受用户 Workspace 内、`.navo/` 外的已有 regular file。发布时：

```text
Workspace source
  -> validate realpath / containment
  -> allocate ResourceId
  -> copy to .navo/assets/<resource-id>/<basename>
  -> recheck Project / owner
  -> append resource-created event
```

复制或事实提交失败会清理本次尚未完成的 Resource root。正式内容目前视为稳定快照；`update_resource` 只修改 name / description / type，不原地替换正文。内容发生变化时注册新 Resource，避免 F9.6d.3 引入多文件更新事务。

### 普通文件 Tool 不能绕过 Resource ACL

Project Agent 的 FileEnvironment 增加 `blockedRoots`，当前把整个 `.navo/` 作为受保护内部区。所有经过 File path resolver 的 `read/write/edit` 都会拒绝进入 `.navo/`；当前 Node Profile 实际只开放其中的 `read`，因此模型无法通过猜测 `.navo/assets/<resource-id>` 路径绕过 Resource ACL。Resource 内容必须先经过 `fetch_resource -> ResourceService.getVisible/resolveEntry` 的授权检查。

`shell` 不使用逐路径 resolver，而是直接以 FileEnvironment cwd 启动进程，因此本 Step **不声称 shell 已被 blockedRoots 沙箱化**。当前 Project Main/Node Profile 均未开放 shell，所以不会形成现有 Resource ACL 绕过面；未来若为 Project Agent 开放 shell，必须另行设计命令级 filesystem sandbox。普通桌面 Session 没有 Project Binding 时继续保持既有 Host 文件环境语义。

### Access 与 ownership 分离

```text
owner Main / Node
  -> Read + metadata Update + domain Delete

non-owner shared/project Node
  -> Read only

Main
  -> all Project Resources readable
  -> setAccess authority
  -> Node-owned Resource content仍 read-only
```

F9.6d.3 没有暴露 `setAccess` Agent Tool；Main 的正式 handoff/grant capability 留给 F9.6e。

### Resource event schema 升级到 v3

`resource-created` 从 `sourceNodeId` 改为 `owner: Main | Node`，replay 只接受 v3 并重新验证 owner、shared Nodes、revision 与生命周期。F9 仍没有生产数据库状态，因此不增加 v2 runtime migration。

## 坑与发现

- 首轮 CI typecheck 发现新 Tool 测试没有先缩窄 ToolResult content block 类型，修复为显式 text block helper。
- 第二轮全量测试大面积失败，根因不是 Resource 逻辑，而是 `ResourceToolsPlugin` 直接访问 Cordis `ctx.tools` 却遗漏 inject；恢复显式 Plugin inject 后 Host/Main/Node/App 全部恢复。
- 修复 Plugin 后只剩 Host 与 research 集成测试的旧工具名单断言；更新为“全局 Registry 已注册 Project tools，但普通 Desktop profile 不暴露；Node profile 暴露 Resource tools”后通过。
- ResourceService 一度超过 300 行审查阈值，因此把 Project/Workspace/revision guards 收敛进 validation；能力测试也按 owner CRUD 与 access/report 拆分，没有用格式压缩规避模块边界。

## 验证

GitHub Actions Windows CI：

```text
pnpm typecheck  PASS
pnpm test       PASS

67 test files
414 tests
414 passed
```

运行时覆盖：

- Node owner register/fetch/update/delete；
- Main owner register/fetch/update/delete；
- Main 对 Node-owned Resource 可读但不可 update/delete；
- shared Node 可 fetch 但不可 update/delete；
- Main-only access mutation领域规则；
- generic read 可以读用户 Workspace 文件，但不能读 `.navo/assets`；
- `fetch_resource` 经 ACL 后仍可读取 Resource，并支持分页；
- Node `send_to_main` 只追加 Mailbox，Node 状态不变，Main Session 不能冒充 Node 调用；
- Resource v3 replay 与 Main/Node ownership；
- 原 Host、Main Session、Node Session、research loop 和 Project Workspace 回归继续通过。

当前等待本机 `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test` 完整验证，因此 F9.6d.3 保持 **🔄**，PR #20 暂不合并。

## 下一步

双重门禁完成后进入 F9.6e：由 Main Agent 正式调用 access/handoff capability，把 Resource 定向 share 给 Node 或设为 Project 可见，并在 Node 后续 Human-started Turn 中注入当前可见 Resource metadata。Resource 到位仍不自动启动任何 Agent。
