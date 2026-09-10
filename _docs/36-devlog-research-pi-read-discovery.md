# Pi Coding Agent 文件探索机制调研

## 做了什么

- 查阅 Pi 当前 `packages/coding-agent/src/core/system-prompt.ts`、`src/core/tools/read.ts`、`src/core/tools/path-utils.ts` 和 `src/core/tools/index.ts`。
- 确认 Pi 默认工具集合为 `read`、`bash`、`edit`、`write`；`grep`、`find`、`ls` 属于可选的只读工具集合。
- 梳理 Agent 通过 Shell 发现路径、再通过 `read` 读取已知文件的调用链。

## 关键决策

- Pi 的 `read` 接收相对或绝对路径，负责路径解析、可读性检查、文本/图片读取、行范围和输出截断；它不负责猜测或遍历未知文件名。
- 没有启用 `grep/find/ls` 时，Pi 的系统提示会引导 Agent 使用 `bash` 执行 `ls`、`rg`、`find` 等文件操作；因此文件发现能力来自 Shell，而不是 `read`。
- `grep/find/ls` 是对 Shell 探索能力的受控替代，当前 Pi 仍保留这些可选工具，并非系统完全没有 `find`。

## 坑与发现

- 如果 SkillWorld 阶段 8 继续明确不提供 Shell，又移除模型可见的 `find`，Agent 将无法可靠发现未知文件，只能依赖上下文中预先提供的路径或模型猜测。
- Pi 将 `read` 的实际读取和模型可见格式化放在同一个工具实现中，同时通过可替换的 `ReadOperations` 保留远程/自定义后端入口；这说明 8.2.2 不一定需要独立设计成“目录发现基础层”。

## 下一步

- 8.1 协议收口已完成；随后按 8.2.2.1–8.2.2.5 依次实现 `read`，每个子步骤单独确认和验收。

参考：

- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/system-prompt.ts
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/read.ts
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/path-utils.ts
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/index.ts

## 采用方案

- SkillWorld 采用 Pi 的四工具面：`read`、`shell`、`edit`、`write`；不把独立 `find` 作为模型工具。
- 具体读取流程由 `read` 工具自身拥有；`shell` 负责文件发现和命令探索，`edit`、`write` 分别负责结构化修改。
- 阶段 8 计划已按 Pi 路线重排；因现有 8.1 协议仍包含 `find`，先完成协议收口，再实现 8.2.2 `Read Tool`，随后实现 `shell`、`edit`、`write`。

## Read Tool 实现调研

### Pi

- `read` 的输入只有 `path`、可选 `offset` 和可选 `limit`；相对路径由工具实例绑定的 `cwd` 解析，绝对路径保留原语义。
- `createReadToolDefinition` 接收 `cwd` 和可替换的 `ReadOperations`。默认实现使用 `fs/promises` 的 `access` 与 `readFile`，因此读取流程仍集中在工具执行器内，同时保留远程或自定义读取入口。
- 执行顺序是：检查取消 → 解析路径 → 检查可读性 → 识别图片或文本 → 读取内容 → 按行窗口选择 → 按行数和字节预算截断 → 返回结果与 continuation 信息 → 清理取消监听器。
- 文本读取先解码 UTF-8、按换行拆分，再把 1-based `offset` 转为数组下标；超出范围失败。若截断，结果会告诉模型当前行范围和下一次 `offset`；单行本身超过预算时返回明确提示。
- 图片处理是独立分支，包含 MIME 判断、二进制读取、可选缩放和模型视觉能力提示；本项目当前阶段不纳入图片能力。
- `path-utils.ts` 只承担路径规范化、相对 `cwd` 解析和存在性变体尝试，不承担文本读取或结果格式化。

### DSH 对照

- `packages/fs/tool-fs/src/read.ts` 由模型工具拥有参数校验、窗口结果和模型输出；底层文件访问通过 `ctx.fs` 的 `stat`、`readText` 或 `streamText` 完成。
- DSH 会先通过元数据判断目标类型和大小，再选择整文件或流式读取；窗口构造和输出保留仍属于 `tool-fs`，观察版本通过事件交给独立策略层。
- SkillWorld 当前不引入 `ctx.fs` 或通用 `io` 层，采用 Pi 的本地直接读取方式；保留已完成的 `path.ts` 作为路径目标 helper，由 `read` 负责从目标到模型结果的完整读取流程。

## 8.2.2 设计结论

- 8.2.2 只实现 UTF-8 文本 `read`，不实现图片、目录发现、Shell 扫描、编辑或写入。
- 8.2.2 拆分为五个子步骤：读取目标预检；文本解码与小文件/大文件读取路线；行窗口与结构化 `ReadResult`；JSON 保存与纯文本模型投影；成功、失败、超限和取消的读取闭环验收。
- 采用 DSH 的混合读取路线：小文件直接读取，大文件流式读取；读取路线的差异不改变窗口、行号、继续读取信息和模型输出语义。
- `ReadResult` 作为可保存和回放的规范结果，模型输入使用由同一结果生成的纯文本投影；结构化元数据不直接以 JSON 字符串充当模型正文。
- 输出同时受 `maxLines` 和固定字符预算限制，只返回完整行；文件还有内容时返回下一次读取位置。
- `read` 的取消必须贯穿路径解析、访问检查和文件读取，并在结束时清理监听器；读取失败只返回稳定的文件工具错误，不泄露宿主诊断。
