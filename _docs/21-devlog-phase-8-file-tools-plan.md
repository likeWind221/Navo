# 阶段 8 通用文件工具与网页结果留存规划

## 做什么

- 在 Tools 根内并列注册 `read`、`find`、`write`、`edit`，统一操作受控的 Session 相对工作区。
- `web_fetch` 在完整网络/正文硬上限内但超过模型内联预算时，将格式化正文写入 `web/` 下的相对文件，模型用 `read/find` 继续定位和读取。
- 原阶段 8–10 依次调整为阶段 9–11：无状态批改、Attempt/Evidence/Verification、Main Agent 与 DAG。

## 关键决策

- 采用 Pi 式并列模型工具，而不是为临时文本与真实工作区重复定义两套 read/write/edit；路径始终由共享纯函数限制到当前 Session 的工作区。
- 本阶段不引入 `FileCore`、`ctx.fs`、Shell、Job、远程或容器 Provider。所有工具直接复用小型路径策略和 UTF-8/原子写入辅助函数，未来需要多后端时再在工具与辅助层之间插入 Harness 式 Provider/Policy。
- `find` 合并路径发现与文本定位：`scope: "path"` 搜索相对路径，`scope: "content"` 在已知文件内返回命中行和预览；底层实现不调用 Shell。
- NodeAgent 默认只得到 `read/find`；`write/edit` 留给后续 Main Agent 或明确授权的 Profile，教材和练习题继续仅由 Node 领域工具修改。

## 坑与发现

- Fetch spill 只能处理已在网络和完整正文硬上限内取得的内容，不能恢复 HTTP 层拒绝或截断的网页。
- 共享文件工具不等于开放宿主文件系统：绝对路径、`..` 越界、符号链接逃逸、非 UTF-8 文本和跨 Session 路径都必须失败关闭。

## 下一步

按阶段 8.1 从文件工具协议与稳定错误开始，先确定模型 Schema、路径语义、分页结果和错误契约，再实现本地 IO。

## DSH 调研修订

- DSH 在 `deepseek-harness/packages/workspace/workspace/src/types.ts` 中把工作区建模为稳定 ID 与规范化目录路径的记录；`deepseek-harness/packages/core/session/src/index.ts` 中的 `SessionHeader.cwd` 在 Session 创建时固化，多个 Session 可以共享同一个 `cwd`，不按 `sessionId` 自动创建物理子目录。
- DSH 在 `deepseek-harness/packages/fs/fs/src/{types,index}.ts` 与 `deepseek-harness/packages/fs/fs-local/README.md` 中将 `cwd` 作为相对路径基准，绝对路径不被基准改写，并以不透明的 `FsTarget` 表达稳定目标身份；`deepseek-harness/packages/fs/tool-fs/` 负责模型工具，`deepseek-harness/packages/fs/fs-observation-policy/` 独立负责观察与版本策略。
- SkillWorld 8.2 吸收共享执行工作区、稳定文件目标、原子修改和目标级并发控制；暂不引入 `ctx.fs`、Provider、独立沙箱后端或版本观察协议，也不把“只允许相对路径”冒充为沙箱边界。沙箱授权留给后续能力。
- 本节覆盖 [8.1 初版开发记录](22-devlog-step-8-1-file-protocol.md) 中“拒绝绝对路径”的旧决策；该记录保留为历史事实，新的路径语义以本节和后续 8.1 修订为准。

## 下一步修订

8.1 路径语义修订与 8.2.1 工作区定位已完成；下一步实现 8.2.2 有界文本读取与目录发现，随后完成原子修改和共享目标并发验收；8.2 完成后再进入 Read/Find Tool 注册。
