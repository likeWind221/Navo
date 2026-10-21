# F13.2a 目录浏览与资料整理实施

日期：2026-10-21。基线：`master` 提交 `ec4fc1e`；设计见 [138](138-devlog-f13-2a-design.md)。

## 做了什么

- SQLite schema 升至 v5，增加项目内显式文件夹记录；v1–v4 通过原有事务迁移，保留旧事件、文件操作和正文数据。
- 可信用户服务提供目录浏览、创建、重命名、移动与删除，以及资料重命名、移动；浏览合并显式空目录与 Resource 路径推导目录，返回资料与正文状态。
- 新增 `resource-organized` 事件；整棵目录移动先计算全部路径和冲突，再将文件夹记录与所有 Resource 事件原子提交，成功后才更新内存投影。Resource ID、owner、access、资产代次与正文状态不变。
- 旧用户元数据入口如修改名称，也改走路径组织操作；同次修改描述或类型时把两条事件一起提交，避免名称与逻辑文件名分离。
- 非空目录删除先返回需确认结果；确认后逐项复用既有 Resource 生命周期，失败返回已删除与失败项，保留目录以供重试。

## 关键决策

- 文件夹身份继续用规范化相对路径；路径比较复用 `libraryPathKey`。移动只改逻辑路径，不搬运资产、不重新提取正文。空目录以显式记录保留；文件夹父级也可由资源或子目录推导。
- ResourceStore 批量追加在一次 `StorageService.atomic` 中写入，并延迟内存投影；SQLite 写入失败时整组回滚。目录删除涉及多个独立文件生命周期，不承诺跨文件回滚。
- 非空文件夹含资料或子文件夹均要求递归确认；取消停止新删除并保留已完成项。失败保留目录记录，按资源 ID 返回成功和失败，重试只处理仍活跃的资料。
- `src/resource/service.ts` 超过 300 行仍作为 Resource 对外服务入口保留：新增目录计算与状态由 `organization.ts` 承担，Service 只保留受信任方法转接、现有权限入口和生命周期编排；此步不拆散原有公开服务契约。
- 参考 DeepSeek Harness `packages/core/agent-loop/src/tool-calls.ts` 的取消后停止新调用、等待已启动调用收敛原则；本步只有元数据事务与既有删除生命周期，没有引入调度器或通用队列。

## 坑与发现

- 旧 v2/v3 迁移测试夹具需要一并删除 v5 的 `library_folders` 表，才能准确模拟旧库；已调整。
- `ResourceService` 不能反向依赖注入 `ResourceContentService`；目录与资料路径由 Resource 层返回，正文状态在已注入 Content 的可信用户服务合成。

## 验证与下一步

- Windows 本机：最终代码 `pnpm typecheck` 通过；`pnpm exec vitest run tests/storage/schema.spec.ts tests/resource` 通过，14 文件 / 128 项。SQLite 第二条 Resource 事件写入失败的故障注入确认数据库与内存均无部分路径更新；递归删除测试覆盖确认、取消、部分失败和重试。
- `pnpm test --maxWorkers=4 --reporter=verbose --testTimeout=30000` 通过，141 文件 / 909 项，含既有 D1–D8 正式 Host 中断恢复。完整运行后只增加 1 项文件夹与文件同名编号测试，并将空目录删除的预取消检查前移；最终代码的 Resource 专项与类型检查已复跑通过。PR head CI 结果待记录。F13.2b 公共 RPC、Electron Bridge 和页面尚未实施，F13.2 父项不得标完成。
