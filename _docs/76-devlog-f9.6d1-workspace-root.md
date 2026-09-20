# 76：F9.6d.1 Project Workspace Root Migration

## 做了什么

F9.6d.1 将 F9.6b 的全局容器布局：

```text
configured-root/
└── projects/
    └── project-<safe-key>/
        ├── assets/
        └── nodes/
```

迁移为用户真实工作目录：

```text
<user-workspace>/
├── 用户原有文件
└── .navo/
    ├── assets/
    ├── nodes/
    └── skills/
```

Project Workspace 现在显式绑定一个已经存在的绝对目录。ProjectId 不再参与物理目录命名；同一 Project 重复绑定同一 canonical root 幂等，重新绑定其他 root 被拒绝，同一 canonical root 也不能同时属于两个 Project。

`cleanup(projectId)` 只删除该 Workspace 下的 `.navo/` 并解除当前进程内绑定，绝不删除用户 Workspace 根目录或用户文件。

F9.6c 的 `assets/...` Resource ref 暂时保持兼容，解析基准从旧 Project root 改为 `.navo/`，因此现有 ResourceStore 不需要在本 Step 同时重构。

## 关键决策

### Workspace 与 Navo 内部区分离

```text
workspace.root
= 用户真实项目目录

workspace.navoRoot
= <workspace>/.navo

workspace.assetsRoot
= <workspace>/.navo/assets

workspace.nodesRoot
= <workspace>/.navo/nodes

workspace.skillsRoot
= <workspace>/.navo/skills
```

Navo 基础设施只拥有 `.navo/`。用户目录里的 `src/`、`.git/`、论文文件等不属于 Workspace Store 的 cleanup 生命周期。

### Workspace binding 仍为 F9 内存状态

当前 `ProjectWorkspaceStore` 保存：

```text
ProjectId -> ProjectWorkspace
canonical root -> ProjectId
```

这只负责 F9 运行期绑定与冲突校验；F10 再把 Project 与 Workspace path 的关系持久化。

### Project-bound FileEnvironment

通用 `FileEnvironment` 新增可选 `workspaceRoot`。未设置时保留 Phase 8 原 Host 文件语义；设置后，existing target、missing target parent、绝对路径和 symlink 最终 canonical target 都必须留在该 root 内。

完整 NavoApp 对 Project-owned Main/Node Session 会把文件环境重绑定为：

```text
cwd = Project Workspace root
workspaceRoot = Project Workspace root
```

因此 Host 本身即使配置了更大的 cwd，Project-bound Agent 的 `read` 也不能通过 `../`、绝对路径或 symlink 读出当前 Project。

这个 Step 没有给 Node 开放 shell/edit/write；现有 Node Profile 仍只有条件化 `read`。后续能力仍由各自 Step 决定。

## DeepSeek Harness 对照

只读参考了：

- `packages/workspace/workspace/src/types.ts`：Workspace 用稳定 ID 表示领域身份，path 是 canonical existing directory，不把路径本身当身份；
- `packages/fs/tool-fs/src/session-cwd.ts`：文件能力从当前 Session 的 Workspace cwd 派生，而不是固定使用 Host 启动目录。

Navo 采用了“用户已有目录 + canonical path + per-session Workspace file scope”的职责划分，但没有复制 DSH 的持久化 Workspace Registry、Session membership、Remote Workspace API。Navo 当前额外规定所有基础设施文件集中在 `.navo/`，F9 binding 仍为内存状态。

## 坑与发现

首轮 CI 暴露测试 helper 把 `await` 写入参数默认值，已改为函数体内异步解析。

随后类型检查通过但文件工具集成失败。真实原因不是路径 containment，而是 Cordis 注入规则：文件 resolver 闭包直接访问 `projects/nodes` 时没有对应 inject，Cordis 返回 `cannot get property "projects" without inject`。最终改为在 NodePlugin 挂载后，通过 `ctx.inject(["projects", "nodes", "projectWorkspaces"], ...)` 建立受生命周期保护的 Project file scope，再供工具执行时查询可信 Agent Binding。

文件 read 的 Host diagnostic 同时保留底层异常文本，但模型侧仍只看到固定、脱敏的 FileError model message。

## 验证

GitHub Actions Windows CI：

```text
pnpm typecheck  PASS
pnpm test       PASS

62 test files
400 tests
400 passed
```

新增/调整的关键测试证明：

- existing user directory 可直接绑定，用户原文件保持不变；
- `.navo/assets`、`.navo/nodes`、`.navo/skills` 被稳定创建；
- 同 Project 不可换 root，同一 root 不可被两个 Project 同时绑定；
-内部 Resource ref 解析到 `.navo/`，portable ref 和 symlink escape 继续受保护；
- cleanup 只删除 `.navo/`；
- bounded FileEnvironment 拒绝相对、绝对和 symlink 越界；
- 即使 Host file cwd 大于 Project root，Project-bound Node Session 的 `read` 仍不能越界；
- F9.6c ResourceStore 的 7 项回归测试全部通过。

用户已完成本机验证：

```text
pnpm install --frozen-lockfile  PASS
pnpm typecheck                 PASS
pnpm test                      PASS
```

因此本 Step 已满足仓库要求的 **本机 + CI 双重门禁**，可以正式收口。

## 下一步

F9.6d.1 完成后，当前唯一下一步进入 F9.6d.2 Resource Lifecycle 与 Access Domain。本 Step 未实现 Resource CRUD v2、权限 grant/revoke、`register_resource`、`fetch_resource`、`send_to_main`、Main handoff、数据库或前端/RPC 契约。
