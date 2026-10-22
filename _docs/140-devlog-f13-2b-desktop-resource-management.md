# F13.2b 桌面资料管理交接实施

日期：2026-10-22。基线：`master` 提交 `e979dad`；F13.2a 设计与实施见 [138](138-devlog-f13-2a-design.md)、[139](139-devlog-f13-2a-library-organization.md)，用户资料导入见 [137](137-devlog-f13-1c-user-intake.md)。

## 做了什么

- 新增版本化资料管理 RPC，覆盖目录浏览与状态跟随、文件夹创建 / 移动 / 递归删除确认、资料重命名 / 移动 / 描述修改 / 替换 / 删除，并保留已有逐项流式用户导入。
- Host handler 只转换公共 ID、组合公开视图并调用既有 `UserResourceService`；目录、权限、revision、替换和删除仍由现有领域服务负责。
- Electron 主进程增加资料控制器、文件选择对话框和 IPC；preload 暴露 `window.desktop.resource`，对请求、响应和推送事件再次做运行时校验。
- 导入与资料库状态跟随返回订阅 ID；替换和递归目录删除使用调用方 operation ID。显式取消只作用于同一窗口拥有的工作；窗口销毁和应用退出会终止该窗口的订阅与未完成操作。
- 正文处理状态变化新增内部通知，使资料库跟随流能从 `pending`、`processing` 更新到最终状态，不暴露 Content Store 或扩大 Resource 权限。
- 新增真实 Electron 验收脚本，通过正式 preload、IPC、mock Kernel Host 和 SQLite 项目验证完整 Bridge 调用链。本步不开发 Renderer 页面，也不引入 RAG、搜索或 Agent 使用资料能力。

## 关键决策

- 单次 RPC 必须恰好返回一个严格结构化结果；持续跟随必须先给基线，后续快照不得跨越请求的 project / path。未知字段、超长字符串、非法联合类型和越界数组均在 RPC 或 preload 边界拒绝。
- 公共错误只保留稳定 code 和有界 message；Host 不把内部异常细节发给 Renderer。部分递归删除保留已完成项并返回 `deleted` / `failed`，未确认的非空目录不产生修改。
- 资料库跟随监听既有 `project/changed` 与新增的正文状态通知，串行重读并对完整快照去重；它不在 Electron 复制资料状态，也不建立第二份缓存。
- 参考 DeepSeek Harness `packages/core/agent-loop/src/tool-calls.ts` 的原则：取消后不再启动新工作，已开始的工作自行收敛。本步由 Bridge 控制器持有 `AbortController` 并按 WebContents owner 清理，没有复制 Harness 的工具调度器、并发队列或 Agent 生命周期。
- 描述修改复用既有用户元数据更新；与重命名或移动同时发生时，沿用 F13.2a 的同批事件提交，避免 Bridge 先后发起两个可能只成功一个的领域操作。

## 坑与发现

- Electron QA 最初只能创建项目，原因是 mock Host 未注册已有资料 RPC；补齐装配后，验收走真实 Host 传输而不是替代业务逻辑的测试桩。
- Windows 上 Electron 退出后 `userData` 仍可能短暂占用；验收只清理本次 home、workspace 与选择文件，保留并打印 Electron `userData` 路径，避免把清理时序误报为 Bridge 失败。
- 根目录 pnpm 当前由 Node 22.23.1 执行并提示仓库要求 Node 24；Electron 实际验收运行时为 Node 24.20.0。CI 使用 Node 24，当前本机结果不能替代 CI 门禁。

## 验证与下一步

- 根目录 `pnpm typecheck` 通过；独立 RPC 套件 `pnpm exec vitest run --config rpc/vitest.config.ts` 通过，8 文件 / 49 项。
- Host / Resource 专项覆盖完整管理路径、revision 冲突、递归确认、正文状态跟随与取消；Electron controller 和 preload 专项覆盖严格校验、owner 隔离、流完成 / 取消、跨范围输出拒绝和窗口销毁清理。
- `frontend` 的 `pnpm typecheck`、`pnpm test`（27 文件 / 159 项）与 `pnpm build` 通过。
- 根目录 `pnpm test --maxWorkers=4 --reporter=verbose --testTimeout=30000` 通过，142 文件 / 912 项，包含 D1–D8 正式 Host 中断恢复。
- `frontend` 的 `pnpm qa:resource` 通过真实 Electron Bridge：创建项目和文件夹、状态跟随、流式导入、浏览、重命名 / 移动 / 描述修改、文件夹移动、替换、递归确认与删除、单资料删除、取消及窗口清理均成功；Electron 44.2.0 / Node 24.20.0，证据目录为 `C:\Users\likeW\AppData\Local\Temp\navo-f132b-evidence-1792640302712`。
- 正式 Renderer 资料库页面仍未实施，F13.2 父项保持进行中；前端当前下一步仍为 F5.4。本记录将在 PR 当前 head CI 后补充 run 与合并提交。
