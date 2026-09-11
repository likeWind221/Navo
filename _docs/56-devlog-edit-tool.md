# 8.2.4 Edit Tool

## 做了什么

- 新增 `edit` 的真实文件执行：按当前 Session 执行世界解析路径，读取现有普通文件，对 `oldText` 做唯一字面匹配后生成完整新内容。
- 匹配不存在、重复或重叠命中都拒绝修改；不做换行符或 Unicode 归一化，`newText` 为空时表示删除。
- 源文件、请求文本和最终结果都执行 UTF-8、NUL、孤立代理项与 5 MiB 边界校验；文件错误继续通过固定 `modelMessage` 暴露给模型。
- 修改先写入目标同目录临时文件，按 64 KiB 分块协作检查取消，写完后保留原权限、`fsync`、关闭句柄，再通过 `rename` 一次提交；提交前失败或取消会清理临时文件且不改目标。
- 新增 Edit Tool 测试，覆盖精确替换、删除、权限保留、重复/重叠匹配、非法 UTF-8/NUL、大小边界、符号链接、取消、临时文件清理和模型错误出口。

## 关键决策

参考 DeepSeek Harness `packages/fs/tool-fs/src/edit.ts` 与底层 `packages/fs/fs/src/index.ts`：采用“模型层只表达精确替换，底层负责完整提交”的职责划分。Harness 把原子编辑、版本检查和可选 observation guard 放在 `ctx.fs.editText` 的 provider 临界区；本项目阶段 8 还没有 `ctx.fs`、版本观察或沙箱 provider，因此当前直接在本地文件边界实现“读完整文本 -> 唯一匹配 -> 同目录临时文件 -> rename 提交”，不复制 Harness 的 `replace_all`、CAS/观察策略和 sandbox escalation。

取消以最终 `rename` 为提交边界：提交前观察到取消就删除临时文件；`rename` 已成功后不再把迟到的取消伪报成失败。当前不实现跨进程锁或版本比较，因此两个并发编辑仍可能以后提交者覆盖先提交者，这一边界留给 8.4/后续并发策略。

## 坑与发现

`FileHandle.writeFile` 不适合作为本步骤“执行中协作取消”的唯一保障，因此改为显式分块 `write`，每次 I/O 前后检查 `AbortSignal`。另外，仅检查最终结果大小不足以约束恶意或异常大的 `oldText` 请求，所以请求文本自身也在读取文件前按 5 MiB UTF-8 上限拒绝。

## 下一步

进入 8.2.5 Write Tool，复用本步骤验证过的“同目录 staging + 完整发布”语义，但增加 `create` / `overwrite` 意图与目标状态校验；完成 8.2.5 后再进入 8.3 Tools 根接入。
