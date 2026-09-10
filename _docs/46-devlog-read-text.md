# 8.2.2 纯文本 Read Tool

## 做了什么

- 连续完成 8.2.2.1–8.2.2.5：普通文件预检、UTF-8 解码、混合读取、完整行窗口、结构化保存出口和模型文本投影。
- `file/read.ts` 拥有参数校验、路径定位、文件句柄与错误收敛；`file/read/window.ts` 拥有增量解码、行计数、窗口预算和文本渲染；`file/types.ts` 增加起始行与读取分流阈值。
- `createReadTool` 返回可注册的 ToolDefinition。宿主按 Session 提供 resolveWorld 和 saveResult；测试使用真实 JSON 文件保存、反序列化并重建相同模型正文。
- 文件工具 3 个测试文件、25 项测试通过，类型检查通过。

## 关键决策

- 参考 [DSH packages/fs/tool-fs/src/read.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/fs/tool-fs/src/read.ts) 的普通文件预检、大小分流、结构化窗口与独立渲染；本项目直接使用 Node 文件句柄，不引入 ctx.fs、Provider 或版本观察策略。
- 小于 5 MiB 时按已知文件大小分配读取缓冲；达到阈值时按 64 KiB 分块。两条路线复用同一读取循环；短读或读取期间文件变长时继续读取，缓冲不会随文件增长。5 MiB 是路由阈值，不是 Read 文件上限，原 maxFileBytes 留给修改工具。
- 严格 UTF-8，移除开头 BOM，拒绝非法序列与 NUL；按 LF 分行，只剥离 CRLF 中的 CR。空文件零行、终止换行不增加虚构行。
- 扫描至 EOF 以取得准确 totalLines 并验证完整文本；仅保留窗口及有界的当前行片段，跳过超长非目标行不积累整行。第一条目标行放不进预算则失败，后续行放不下则停止收集并返回 nextLine。
- 保留 startLine/maxLines 协议；默认 200 行、最多 1000 行，模型正文含路径与行号在内不超过 30000 个 UTF-16 代码单元。为标题和继续读取提示预留预算，完整行不截断。
- 保存由宿主回调负责，保存失败工具失败；默认应用、SessionLog 与 UI 的实际装配留在 8.3。取消为协作式，每次文件操作前后检查，finally 关闭句柄；宿主回调须自行结束，当前不承诺强制中断宿主回调或操作系统中正在执行的单次 read。

## 坑与发现

- TextDecoder 必须在 EOF flush，才能拒绝末尾残缺 UTF-8；跨块中文、BOM 与 CRLF 已验证。
- 读取使用路径 stat 预检并在打开后 fstat 复核；这不是并发替换或沙箱隔离保证。权限错误已归类，当前 Windows 测试未覆盖 ACL 拒绝与 FIFO 等特殊文件。
- 当前 ToolOutput 只支持文本，因此结构化保存出口属于 Read 工具配置，不更改跨端公共协议。

## 下一步

- 当前子阶段 8.2.2 已完成，下一步 8.2.3 Shell Tool；8.3 负责默认注册、Session 保存装配和 Fetch spill。
- 本次授权范围为纯文本 Read，未实现图片、目录发现、Shell、Edit、Write 或沙箱；代码导读随本次交付提供。
