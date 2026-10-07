# 72：Resource 访问级别 project 更名为 public

## 做了什么

- 按用户要求，把 Resource access 的 `project` 取值更名为 `public`，行为不变：`public` 表示本 Project 内所有工作 Node 可读。
- 涉及领域类型 `ResourceAccess`、访问归一化与读权限判断、事件历史校验、`set_resource_access` 工具枚举与错误消息、`fetch_resource` 描述、Main 提示词及相关测试；`backend-plan.md` 中的 ACL 描述同步更新。
- `set_resource_access` 的 `kind` 增加说明：private 仅 owner 与 Main；shared 另加列出的 node_ids；public 为本 Project 所有工作 Node；访问永不越出 Project。

## 关键决策

- 每个 Resource 本身就属于某个 Project，`project` 无法表达它与其他级别的区别；用户认为 `public` 更易理解。为避免模型或读者误解为“项目外可见”，在工具参数说明与 Main 提示中明确限定为“本 Project”。备选名 `all_nodes` 未采用。
- 读权限按两层理解：角色层（Main 可读全部、owner 可读自己的）优先判断，access 只约束其他 Node。写权限不变：仅 owner 可改元数据或删除，仅 Main 可改 access。
- Phase 9 的 Resource 元数据仍是内存状态，没有已持久化数据，因此不需要迁移或兼容旧值。

## 坑与发现

- 前端 `frontend/**` 中的 `"project"` 是工作区导航分类，与 Resource access 无关，未修改；目前也没有共享契约引用该取值。
- 历史开发记录中的 `project` 访问级别保留原文，不回改。
- PR #33 先合入 master；本 PR 变基后仅 `_docs/index.md` 冲突，已手工合并，代码无冲突。原定编号 70 被 BUG 修复笔记占用，本记录改为 72。
- 本机 Node v24.14.0：`pnpm typecheck` 通过，`pnpm test` 79 个文件 / 462 项通过（基于合入 PR #33 后的 master）。未运行真实模型。

## 下一步

- 用户审核 Draft PR 后决定合并；F9.9 跨端契约设计时直接使用 `public`。
