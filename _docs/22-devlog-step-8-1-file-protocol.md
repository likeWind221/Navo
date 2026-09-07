# Step 8.1 文件工具协议与稳定错误

## 做了什么

新增 `src/tools/builtins/file/types.ts` 与 `errors.ts`，定义 read/find/write/edit 的模型 Schema、请求与结果类型、协议上限及 FileError。仅定义契约，尚未注册工具或执行 IO。

## 关键决策

- Session 身份只由 ToolExecutionContext 注入，模型不能传 sessionId、宿主根目录或绝对路径。相对路径使用 /，拒绝路径穿越、Windows 驱动器/UNC/ADS/保留名、控制字符及尾随点/空格；8.2 负责实际路径校验与符号链接隔离。
- read 默认从第 1 行读 200 行，最多 1000 行；固定输出预算 30,000 字符包含呈现元数据。仅返回完整行，预算不足时通过 nextLine 续读；单行无法装入预算则 output-too-large，可改用 find 查看有界预览。
- 文本按 LF 分行，CRLF 去除配对 CR；空文件 0 行，尾随 LF 不产生虚拟空行。起点超过 EOF 返回空结果及 null continuation。分页不承诺跨调用快照一致性，文件变化后需从头定位。
- find 必须指定 scope。path 模式按相对文件路径的区分大小写字面子串匹配，按 JS 字符串比较排序；offset 是匹配结果的零基偏移。content 模式必须提供一个文件，按行匹配非空单行字面 query，每命中行一项，startLine 与 nextLine 均为一基行号。两种模式分别拒绝 startLine 和 offset，不执行 Shell、正则或 glob。
- find 默认最多 50 项、上限 200 项，query 上限 1024 字符。内容预览最多 500 字符，返回预览起始列及截短标记；列号按 UTF-16 单位计数。预览应包含首次命中起点，长 query 无需全部进入预览。所有截短必须保持有效 Unicode。
- 路径扫描最多 10,000 个目录项，超限整体返回 scan-limit-exceeded，避免部分排序集合导致漏页；内容扫描每次最多 10,000 行，可返回空 matches 加严格推进的 nextLine。路径 offset 超出结果集返回空 paths 和 null。
- write 必须显式指定 create 或 overwrite：前者要求不存在，后者要求现有普通文件。edit 对非空 oldText 执行唯一精确替换，重叠命中也计入多次匹配；不做换行或 Unicode 归一化。newText 可为空以删除。
- 文件及写入后结果上限 5 MiB UTF-8；拒绝非法 UTF-8、NUL 及模型字符串中的孤立代理项。请求字符串也需在执行层先做有界验证。写入结果只返回相对路径、操作类型与提交字节数。
- 所有操作须有权威 Session 且支持预取消与执行中协作取消。后续原子写入以提交为边界：提交前取消不能修改目标，提交成功后不可伪报未写入；本步不实现取消或原子提交算法。
- FileError 保留内部 message/cause，模型只使用固定 modelMessage；不回显绝对路径或底层异常。稳定错误覆盖请求、Session、路径、类型、文本、预算、编辑匹配、权限、IO 与取消。

## 坑与发现

ToolService 的 JSON Schema 子集不支持 oneOf、minimum/maximum、pattern 或字符串长度约束。因此本步使用兼容的字段、required、enum 与 additionalProperties，并明确在 8.2–8.4 执行边界校验范围和 scope 条件。Schema 不是路径沙箱，也不代表文件工具已上线。

参考 `deepseek-harness/packages/fs/tool-str-replace-editor/src/index.ts` 的精确唯一替换、行号视图与安全错误边界，以及 `packages/spill/spill-policy/src/types.ts` 的权威 Session 所有者。采用当前阶段规划的四个并列工具和 Session 相对路径，不复制 Harness 的绝对路径、ctx.fs、多 Provider、观察策略或 Shell 查找建议。

文档按原编号顺序重新连续编号，同步现有文档引用；历史附录中的原已删除文件名作为追溯标识保留，不视为现存文件链接。

## 验证

- pnpm typecheck 通过。
- 使用现有 snapshotParameters/parseToolArguments 验证 4 个 Schema、5 组有效请求及 5 组非法请求；错误 message/cause 与模型文案隔离断言通过。
- 文档编号为连续 00–22，现有 Markdown 本地链接无断链，git diff --check 通过。
- 未运行文件 IO 行为测试：本步未实现 IO；该部分由 8.6 验收。

## 下一步

完成 8.1 后等待人工审查，再进入 8.2 路径策略与 UTF-8/原子写入辅助层。8.3–8.6 的注册、IO 行为测试与 Fetch spill 尚未实现。
