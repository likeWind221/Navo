# F13.1b 正文提取与处理恢复实施

日期：2026-10-21。基线：最新 `master`，`30aebc9`（PR #86）；独立分支 `phase13-f13.1b-content`。
授权：按 [134 冻结设计](134-devlog-f13-1b-design.md) 实现 F13.1b，提交并创建目标为 master 的 PR，明确不直接合并。当前只由 Codex 串行维护计划、索引与本记录，没有委派或跨端代码修改。

## 做了什么

- `src/storage/content.ts` 实现冻结的 STRICT DDL、复合主键 CRUD、条件领取与带代次 / attempt ID 的提交；`schema.ts` 保留 v1→v2→v3 并新增 v4 迁移，`database.ts` 将正文方法接入原有事务。
- `src/resource/content/extraction.ts` 只读取已保存资产，统一 UTF-8 BOM 与换行，保留 Markdown 语法；`pdf.ts` 使用固定的 `pdfjs-dist@6.4.299`，按页提取、识别 hasEOL、先规范化再计算最终 UTF-16 区间，空白页保留页号。结果联合类型区分 ready 与 metadata_only，异常独立定义于 `errors.ts`。
- `src/resource/content.ts` 是串行处理协调器，拥有运行任务、AbortController、停机状态与本次进程禁止自动重入的集合；`content/store.ts` 负责状态转换、当前代次读取校验与双向恢复对账。解析不在 SQLite 事务内，正文和 ready 同事务提交。
- `ResourceService.publish/replace` 完成后发送内部 `resource/committed` 通知；正文排队失败只记录固定诊断，不回滚原始资产。`ResourceLifecycle.delete` 将删除事件与正文删除放进同一事务。
- `src/app.ts` 在 ResourceRecovery 之后挂载处理器并只做元数据对账，全部应用装配结束后用 setImmediate 开始正文消费；正式 Host 的 ready 输出先于异步提取。`StorageService.beforeClose` 在关闭数据库前等待正文停机与清理，避免 Cordis 并行 dispose 先关闭 SQLite。
- `tests/resource/content/` 覆盖提取、状态、代次、读取租约、删除、恢复与故障；`tests/storage/content.spec.ts` 覆盖约束、项目隔离、迁移与事务；`tests/host/process/content.ts` 及其独立子进程入口覆盖真实 SIGKILL 和两次正式 Host 恢复，复用既有进程验收 Harness 并保持同文件串行持有 Host 锁。

## 关键决策

- 状态为 pending / processing / ready / metadata_only / failed。每次领取新 UUID；SQL 条件更新阻止重复领取和过期尝试覆盖。正文读取同时核对当前 Resource、ready 与来源代次；名称等 revision 变化不会触发重新提取。
- 不支持格式为 metadata_only；支持格式为空（含无文字 PDF）、损坏、超限、取消或超时均为 failed。失败与 metadata_only 不因普通通知 / 重启重复处理，显式 retry 才重置 pending。
- 固定资源上限：单任务、原始文件 100 MiB、正文 UTF-8 16 MiB、PDF 2000 页、单次 120 秒。真实生成的多页 / 空白页 PDF 和 2000 / 2001 页样例验证页码与准入边界；正文字节边界另用 UTF-8 多字节文本及缩小的注入限制验证。该选择是首版有界策略，不是性能 SLA。
- 持有 resolveEntry 读取租约直到提取及解析器清理完成，在 finally 释放；释放后运行现有资产恢复以清理旧代次。旧任务结束后先核对 Resource 代次，再用当前 processing / attempt ID 提交；任何不匹配都不发布结果。
- 专用 shutdown signal 与运行期取消分开：停机先条件撤销当前尝试为 pending，再取消解析并等待实际清理，不继续领取；运行期取消 / 超时为 failed。持久化失败后本进程不立即无限重排该代次，保留 pending / processing 供下次启动恢复。
- 正向对账补建 / 重置缺失或过期行，恢复遗留 processing；反向清理已删除 Resource、缺失 Resource / Project 的孤儿行。因项目恢复失败而不可用的记录保留，不误判为已删除，也不领取处理。
- 本次只读核对 [DeepSeek Harness `packages/document/office-to-pdf/src/queue.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/document/office-to-pdf/src/queue.ts)，采用显式取消、等待真实清理后释放容量与 dispose 等待任务；不采用其优先级、缓存、共享读者、哈希去重或 Office 转换管线。已核对锁定 PDF.js 类型定义：page.cleanup() 是同步 boolean，loadingTask.destroy() 是 Promise；取消立即请求 destroy，最终仍 await 同一清理 Promise。

## 坑与发现

- Cordis 访问其他 Service 必须声明 inject。ResourceService 不反向依赖正文 Service，而发送内部提交通知；因此没有 resources↔content 注入环。
- 后台提取新增真实读取租约，既有资产测试中“delete 返回即物理清理完成”的假设不再成立。只在相关物理清理断言前等待正文 idle / 原有 recovery，保留删除不可读、租约固定代次与原有清理断言。
- v1 / v2 迁移夹具原先只删除 v3 文件操作表；补充删除 v4 正文表，让夹具准确代表旧版本。没有修改生产迁移来容忍伪造的旧版本。
- SQLite 写入失败使用固定、安全的诊断摘要；不保存解析器完整堆栈或绝对路径。原始文件操作仍然独立成功。
- 补充收尾窗口回归：最后一次 pending 扫描返回空与 worker Promise 结束之间到达的显式 retry 不能丢失。协调器记录 requested 通知，真实任务结束后再安排一次 drain；这不是对失败任务的自动重试。
- 既有 `tests/host/process.spec.ts` 超过 300 行，本次只新增专项注册调用，保留该入口作为串行拥有全局 Host 单实例锁的测试装配边界；新增场景与子进程入口均拆至所属目录，不在既有大文件展开实现。

### 验证

环境：Windows PowerShell，Node v24.19.0（内置运行时），pnpm 10.33.0；PATH 前置该 Node 与 Windows System32。默认 shell 的 Node 22 不用于最终验证。

- `pnpm typecheck`：通过。
- `pnpm test`：首轮 139 文件 / 890 项通过（284.59 秒）；新增调度收尾窗口回归后专项通过，最终 `pnpm test --maxWorkers=4`：139 文件 / 891 项全部通过（279.33 秒），包含全部 D1–D8 与正文强杀恢复；进程退出码 0。
- `git diff --check`：通过；交付前再次检查新增文档。
- 专项已验证真实 SIGKILL：处理权提交后杀死进程，等待真实 Host 锁自然过期，再由两次正式 Host 启动恢复 ready，Resource 事件保持不变。该场景不模拟宿主机掉电或磁盘损坏。
- 验收矩阵 1–3、7、11：提取 / 处理专项覆盖文本、PDF、metadata_only、空正文、损坏、逐页失败、重复触发、资源限制、取消 / 超时与清理等待；4 为真实子进程强杀；5–6、8、10 为替换 / 删除 / 迟到结果 / 代次不符及双向对账；9 为 SQLite 事务回滚与写入失败后重启；12 为删除事件和正文行同时提交 / 回滚。

### 边界

- 不实现 F13.1c 用户 owner / 导入 / 重试公共 RPC、F13.2 管理、F13.3 Chunk / Embedding / 索引 / 检索、F13.4 决策或前端页面。内部 read/status/retry/cancel 是服务能力，不是已发布的桌面协议。
- PDF 只提取已有文字，不做 OCR、表格 / 公式 / 多栏重建。页码区间可供后续 F13.3 使用，但当前没有索引。
- 超时由 AbortSignal 与 PDF.js destroy 协调，不是操作系统级 CPU / 内存隔离；无法抢占阻塞 Node 事件循环的同步解析代码。样例与单测不代表所有现实 PDF 都可正确恢复排版，也未做大型真实资料库性能评估。
- 未运行真实模型，不对检索效果作结论。PR 按授权保持未合并；计划保持 🔄，不把本机测试等同于合并或 CI 收口。

## 下一步

本机验证已通过；提交并交付本 Step PR，GitHub CI 结果以当前 PR head 为准；由用户审核后决定后续处理，不自动合并或开始 F13.1c。代码导读随本次最终回复交付，涵盖存储、提取、处理与启停接入。


## 合并收口（2026-10-21）

- PR #87 已合并至 `master`，合并提交为 `845b864f8f5d136c7704c7c53e61f47ba8ccbc71`。
- 当前 PR head 的 GitHub Actions CI run [39542644391](https://github.com/likeWind221/Navo/actions/runs/39542644391) 结果为 success。
- 上文“待审核 / 不合并”等文字记录实施当时的授权与状态；本节记录后续合并结果，不改变本 Step 的验收边界。
