# 73：F9.6b Project Workspace Foundation

## 1. 目标与边界

F9.6b 只解决一个基础问题：**Project 的真实文件属于哪个物理边界，以及 Project 内相对引用如何安全落到该边界。**

本 Step 不建立 Resource Registry，不给 Main / Node Agent 增加工具，不修改 Host / RPC / frontend，不加入数据库、RAG 或动态 Context reload。

## 2. 领域模型

新增 `src/workspace`，由 `ProjectWorkspaceStore` 提供：

- `create(projectId)`：幂等创建当前 Project 的 Workspace；
- `get(projectId)`：读取已存在 Workspace；
- `resolve(projectId, ref)`：把 Project-relative ref 安全解析到物理目标；
- `cleanup(projectId)`：只清理指定 Project 的 Workspace。

物理结构为：

```text
<configured-root>/
└── projects/
    ├── project-<safe-key-A>/
    │   ├── assets/
    │   └── nodes/
    └── project-<safe-key-B>/
        ├── assets/
        └── nodes/
```

`projectId` 不直接拼入文件系统路径，而通过 SHA-256 形成固定安全目录键。这样即使历史恢复得到非 UUID 形式的 ProjectId，也不能通过分隔符或特殊路径文本影响 Workspace 层级。

绝对物理路径只是 Host 执行细节；后续 Resource 的稳定身份必须保存 Project 内相对 `ref`。

## 3. 路径边界

Workspace ref 使用可移植的 `/` 分隔相对路径，例如：

```text
assets/report.md
nodes/<node-ref>/notes.md
```

解析层拒绝：

- 空 ref、NUL；
- 绝对路径与 Windows drive path；
- 反斜杠形式；
- 空 segment、`.`、`..`；
- 经过真实路径解析后落到 Project Workspace 之外的目标；
- dangling symlink 被伪装成“安全缺失文件”。

核心不是字符串过滤本身，而是最终 containment：

```text
Project-relative ref
        |
        v
lexical candidate
        |
        v
realpath(existing target / parent)
        |
        v
canonical target ∈ canonical Project root ?
        | yes
        v
      accept
        |
        no
        X
```

因此即使 ref 本身没有 `..`，`assets/escape/secret.txt` 中的 `escape` 是指向 Workspace 外部的 symlink，也会被拒绝。

## 4. 与已有 File Tool 的关系

F9.6b 没有修改 `src/tools/builtins/file/path.ts`。现有 FileEnvironment 的 `cwd` 负责“从哪里解析路径”，不声称提供 Project containment；Project Workspace 则负责“这个路径是否仍属于当前 Project”。

两层职责保持分离：

```text
Project Workspace
  -> ownership / containment / stable relative ref

Generic File Tools
  -> read / shell / edit / write execution semantics
```

后续 F9.6d 再通过可信 Session Binding 把 Node 的文件能力接到对应 Project Workspace，而不是在 F9.6b 提前改 Agent Tool。

## 5. DeepSeek Harness 对照

开发前只读检查了 DeepSeek Harness 当前 Workspace / filesystem / sandbox 源码。

可借鉴的边界是：

- Workspace identity 与 canonical filesystem path 分开；
- local filesystem 的 `cwd` 明确只是 resolution default，不是 containment boundary；
- 真正的 Workspace 写入边界由独立 policy / enforcing layer 负责。

Navo 当前只采用这种职责分离，不照搬 DSH 的 Workspace 持久化、Session membership、完整 Sandbox Policy 或远程文件系统抽象，因为它们超出 F9.6b。

## 6. NavoApp 装配

`NavoAppConfig` 新增可选 `workspace.root`。只有调用方显式提供可信绝对根目录时，`NavoApp` 才挂载 `ProjectWorkspaceStore`。

这里没有给 Kernel Host 增加环境变量或 RPC：F9.6b 的计划明确不修改 Host；公共产品入口等到后续跨端契约 Step 再统一接入。

## 7. 验收

新增 `tests/workspace/store.spec.ts`，覆盖：

1. 不同 Project 的 Workspace 物理隔离；
2. create 幂等、get 可读取；
3. `assets/`、`nodes/` 稳定结构；
4. existing / missing leaf 的 Project-relative ref 解析；
5. `..`、绝对路径、Windows drive、反斜杠和空 segment 拒绝；
6. symlink 逃逸拒绝；
7. 清理 Project A 不影响 Project B；
8. 不存在 Project 不能获得 Workspace；
9. 显式 root 下可通过 `NavoApp` 挂载；
10. 配置 root 暂时不存在时失败，修复目录后可重新尝试。

PR #16 的 Windows GitHub CI 最终通过 `pnpm typecheck` 与全量 `pnpm test`：61 个测试文件、390 项测试全部通过。

CI 过程中还修正了两个实现/测试问题：在 `exactOptionalPropertyTypes` 下将可重置 Promise 显式声明为 `Promise<string> | undefined`；Windows runner 上比较 Workspace 根目录时改用 canonical base path，避免临时目录真实路径拼写差异造成脆弱断言。

## 8. F9.6b 完成后的边界

当前已经形成：

```text
Project
  +-- Roadmap
  +-- Main / Node Binding
  +-- Mailbox
  +-- Workspace
        +-- assets/
        +-- nodes/
```

仍然没有：

```text
Resource Registry          <- F9.6c
register/fetch/report tool <- F9.6d
Main resource handoff      <- F9.6e
full handoff integration   <- F9.6f
```

**下一步唯一进入 F9.6c Project Resource Registry。**
