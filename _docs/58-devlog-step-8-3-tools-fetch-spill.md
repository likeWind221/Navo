# 8.3 Tools 根、Node 白名单与 Fetch spill

## 做了什么

- `ToolsPluginConfig` 新增可选 `file` 能力。只有宿主显式提供 `resolveFileEnvironment(sessionId)` 时，Tools 根才注册 `read / shell / edit / write`；四个工具共享一个 `FileObservationStore`，未启用时不会默认开放宿主 `process.cwd()`。
- Kernel Host 新增可选 `SKILLWORLD_FILE_CWD`。提供时启动阶段通过 `createFileEnvironment` 规范化并固定 cwd，再交给 Tools 根；未提供时文件工具保持关闭。
- FetchTool 新增内部 spill 路径：完整格式化正文超过模型内联预算时，若存在 FileEnvironment，则写入 `web/fetch-*.md`，返回有界 preview、`file_path` 与 `read` 提示。Fetch 不调用模型层 `write`。
- Fetch spill 与 Edit/Write 共用 sibling staging 原子写；新增 `spill-failed`，把“网络已经成功但本地留存失败”与 `network-failed` 分开。
- NodeAgent 按实际工具注册状态决定是否加入 `read`；即使文件环境启用，也不向 NodeAgent 暴露 `shell / edit / write`。教材和练习题仍只能通过 Node 领域工具修改。
- 修复 8.2.5 遗留接口错位：Read 使用 `observeRead(sessionId, result)` 累计分页观察，Write 成功使用 `observeWhole(sessionId, path)`。

## 数据流

```text
Host: SKILLWORLD_FILE_CWD
          │
          ▼
   FileEnvironment
          │
          ▼
      ToolsPlugin
     /    |    |    \
  read  shell edit  write
    │                 │
    └── Observation ──┘

web_fetch
    │
    ├─ <= inline budget ──> complete inline text
    │
    └─ > inline budget
           │
           ▼
    web/fetch-*.md   ← atomic internal spill
           │
           └────────> preview + file_path
                              │
                              ▼
                         NodeAgent read
```

## 安全边界

- File capability 是宿主显式能力，不是默认宿主文件系统访问权。
- Spill 文件不会因创建而自动进入 `FileObservationStore`；模型只看了 preview，后续若要整文件覆盖仍需完整 `read`。
- 本步骤仍不解决 `read(V1) -> external/Shell write(V2) -> structured write/edit` 的 stale 问题，也不保证并发 create-if-absent；统一进入 8.4。
- `web/` 当前服从既有 FileEnvironment 路径/符号链接语义；沙箱授权不是本步骤目标。

## Focused checks

新增 focused tests 覆盖：文件能力未配置时不注册四工具、配置后四工具共享观察门禁、Fetch 超限后写完整 spill 并返回有界 preview、过小预算不留下 orphan spill、NodeAgent 只增加 `read`、Host 文件 cwd 显式配置。当前环境缺少项目 Node 24/pnpm 依赖，因此这里只执行源码/测试的 TypeScript 语法级检查；全量 typecheck/test/build 统一留到 8.5 Work 验收。

## 下一步

进入 8.4 文件并发与版本安全收口：为观察记录加入可比较版本，对 Edit/Write 做 optimistic guard，补齐并发创建与必要的目标级串行化，并明确 Shell/外部副作用让旧观察失效的规则。源码完成后进入 8.5 Work 模式最终工程验收。
