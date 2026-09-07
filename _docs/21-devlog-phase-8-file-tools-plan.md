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
