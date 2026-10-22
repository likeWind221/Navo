# F13.2 状态校准与 F13.3 后端交接

日期：2026-10-22

## 当前结论

- F13.2a「目录浏览与资料整理」已通过 PR #89 合并至 master，实施与验收见 [139](139-devlog-f13-2a-library-organization.md)。
- F13.2b「桌面资料管理公共 RPC 与 Electron Bridge」已通过 PR #90 合并至 master；squash 提交为 `d470f6f`，验证记录收尾提交为 `93245f0`，实施记录见 [140](140-devlog-f13-2b-desktop-resource-management.md)。
- **不新增 F13.2c。** F13.2a / F13.2b 已完成其后端和桌面公共能力交付；F13.2 父项仍保持进行中，因为正式 Renderer 页面与交互验收未完成。该 UI 工作独立登记在 [frontend-plan.md](frontend-plan.md)，不属于当前后端主线，也不阻塞 F13.3。
- 当前 F13 后端主线进入 F13.3「内容检索与原文定位」，下一动作是 F13.3a 的只读代码审计与技术设计。**F13.3a 尚未开始编码，检索算法、索引方案和新增公共契约均未冻结。**

## 当前计划边界

```text
已完成：
F13.2a 目录管理后端
        |
        v
F13.2b 公共 RPC + Electron Bridge
        |
        v
当前下一步：
F13.3a 只读代码审计 + 技术设计（尚未编码）
        |
        v
用户审核设计后，再决定是否实施
        |
        v
后续 F13.3b：搜索公共 RPC + Electron Bridge
        |
        v
F13.4 Agent 按需使用资料

独立的前端工作队列：
F13.2 Renderer 页面与交互验收（待实施；不新增 F13.2c）
当前前端下一步仍为 F5.4，按 frontend-plan.md 管理
```

## F13.3a 设计前需要核对的内容

只读审计应从最新 `master` 出发，优先检查：

1. F13.1b 正文提取、正文状态、代次保护、重处理与恢复机制。
2. Resource 的 project、owner、access、`libraryPath` 和现有可见性规则；文件夹范围需按规范化逻辑路径及后代关系确定。
3. 现有正文存储与读取接口、Resource revision / asset generation 的一致性边界。
4. SQLite schema、事务与迁移约定，评估是否需要增量索引或可重建索引。
5. 现有 RPC / Host / Electron Bridge 结构仅用于明确 F13.3b 的交接边界；当前不提前实现搜索 RPC 或 Renderer 搜索页面。
6. 仓库对外部依赖和 Harness 参考的约定；先核对再决定是否需要新依赖。

## F13.3a 已确认的产品约束

- 所有文件格式都支持文件信息搜索；正文搜索首版只针对 Markdown、TXT 与可提取文本的 PDF。
- 搜索可限定整个项目或指定文件夹及其后代。
- 结果按 Resource 去重，正文命中应返回有来源关联的片段；Agent 能继续读取对应正文。
- 明确区分无结果、正文处理中、仅文件信息可搜索和正文处理失败。
- 权限必须在结果、片段和正文返回前执行，不能泄露无权资料的标题或内容。
- 分页、搜索结果与正文读取不得混用资料变更前后的状态；需定义 revision / generation 校验或一致性策略。
- 不在设计阶段预先锁定全文检索算法、Embedding、重排模型或向量数据库；先依据现有数据规模、文本能力、更新/删除与一致性约束选型。
- 不做 Renderer UI，不增加 F13.2c，不扩展 Node 的资料管理权限，不把正文预览纳入搜索交付。

## 交接状态

本记录只校准路线并为新会话提供入口。尚未进行 F13.3a 代码审计、技术设计、代码修改或测试；新会话应先读取本记录、`_docs/backend-plan.md`、`_docs/frontend-plan.md`、F13.1b / F13.2a / F13.2b 实施记录及 `AGENTS.md`，然后开展只读审计并输出图解设计供用户审核。
