# F13.1c 用户资料补充与管理接入实施

日期：2026-10-21
基线：`master` 提交 `77a3957`，F13.1b 随 `845b864` 合并。

## 做了什么

- 增加固定 User principal。用户资料创建事件一次写入 `owner=user` 与项目内 `public`；旧创建事件继续默认 `private`。现有 Agent 发布、更新、替换、删除仍拒绝伪造 User 主体。
- 新增可信 Host 用户导入服务及 `resource.user-import.v1` 流式 RPC。单文件、多文件与目录按确定顺序逐项保存，保留相对路径、同目录重名编号与逐项结果；每项独立复用 F13.1a 操作记录和资产生命周期，提交后通知 F13.1b 处理正文。
- 用户管理服务提供更新、替换和删除内部入口，可管理项目内 Agent 资料但保留原 owner；资料浏览和相应桌面管理 RPC 留给 F13.2。

## 关键决策

- 请求只接受 Project、稳定请求 ID 和可信桌面 Main 提供的绝对来源路径，不接受 actor/owner。绝对源路径只在本次文件读取闭包中使用；操作记录保留非绝对 `sourceRef`。单个请求最多 32 个来源、256 个文件、1024 个目录和 1 GiB 文件总量；单文件仍受 100 MiB 资产限制。
- 逐文件结果使用流式输出，取消后停止启动后续文件；已提交项保留。单文件同 ID 重放可在原来源消失后返回已提交结果；目录清单不持久化，整个目录消失后不能重建尚未返回的清单。
- `src/resource/lifecycle.ts` 超过 300 行仍保留一个文件：创建、替换、删除共享同一操作状态、资产代次、原子提交和恢复边界，拆散会重复这套状态机。
- 参考 F13.1b 已核对的 DeepSeek Harness `packages/document/office-to-pdf/src/queue.ts` 有界准入和取消后等待处理结束原则；本阶段沿用 Navo 的单文件生命周期，不引入 Harness 的队列、共享读者或 Office 转换管线。

## 坑与发现

- F13.1b 的 `ResourceService.publish` 只接受 Workspace 相对来源，用户导入必须使用独立受信任入口；正文状态由 `resource/committed` 通知接续，不能直接改正文表。
- `project.resources.v1` 的旧 owner 输出只识别 Main / Node；新 User owner 需一并扩展输出校验，否则资源列表会解析失败。
- Windows 当前会话创建普通文件 symlink 返回 EPERM；测试改用 junction 验证目录链接不被遍历。

## 验证与下一步

- 本机 Windows / Node 24：`pnpm typecheck` 通过；Resource / RPC / Host 定向测试 15 文件 / 147 项通过；最终代码 `pnpm test --maxWorkers=4` 通过，140 文件 / 896 项。当前 PR head CI 待记录。
- 尚无 Renderer 页面、Electron 文件选择器与正式 Bridge 点击级验收；F13.2 接入桌面管理和资料浏览。F13.1c 仅交付 Host RPC 与内部管理服务。
