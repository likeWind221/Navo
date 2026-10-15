# 20：开发文档整理（2026-10-15）

## 做了什么

Phase 10 收口后整理 `_docs/`，纯文档变更，不涉及代码。下文“整理前编号”指本次整理开始时的编号。

- **命名规范化**：

  | 原路径 | 新路径 |
  |---|---|
  | `01-deepseek-harness-单对话核心与最小-agent-闭环设计.md` | `01-harness-design.md` |
  | `02-阶段-0-工程骨架开发记录.md` | `02-devlog-phase-0-scaffold.md` |
  | `23-structure.md` | `23-structure-plan.md` |
  | `24-structure.md` | `24-devlog-structure.md` |
  | `codex-reviews/`（10 份报告） | `30-codex-reviews-archive.md` |

- **合并碎片文档**（保留一篇的编号，正文开头注明整理前编号）：
  - 30 命令调度设计 → 并入 31（F3.2.3）；
  - 58 F5.2 接入核对 → 并入 77（F5.2，现为 75）；
  - 69 F10 初始规划 → 并入 80 文末附录（F10.0，现为 78）；
  - 96 F10.2a 方案、97 F10.2a 实现 → 并入 95（F10.2，现为 93）。
- **新增**：19 收纳原 `backend-plan.md` 第 12 节“桌面工具可用性排查”；20 为本记录。两者与 30 号归档占用整理前已空出的 19、20 号和合并后空出的 30 号。
- **编号重排**：合并空出的 58、69、96、97 由后续文档依次前移补齐，整理后编号 00–99 连续；全部引用链接、以编号为文字的链接标签和文档标题中的编号同步改写。对照表见下文。
- **计划文档**：
  - `backend-plan.md`：已完成的 Phase 0–8、F9、F10、M1 压缩为“功能目标 + 记录链接”，保留用户免除真实验收的事实；Node 状态约定与“只有工作节点”并入核心契约；M1 提为正式一节；“当前下一步”只保留 F11.0 与未关闭 Bug；Resource 访问级别同步为 `public`。
  - `frontend-plan.md`：F10.1–F10.3 交接合并为一条，“当前下一步”只保留 F5.4 与待接入的后端交付，源码目录整理移入“工程维护记录”。
  - `bug-plan.md`：勾选列表与明细表按 ID 排序，日期段落移入“处理时间线”，修复 BUG-006 行内换行导致的表格断裂。
- **索引**：`index.md` 按“产品与计划 → 后端 Phase 0–8 → Phase 9 → Phase 10 → M1 → Bug → 前端 → 工程治理 → 调研与归档”重排，节内按编号正序。
- **治理规则**：AGENTS.md 文档编号规则明确为“删除或合并后后续编号前移、同步改写引用”；`.gitignore` 删除已失效的 `codex-reviews` 规则；16 号文档标注为历史快照。

## 编号对照

整理前编号未列出的文档编号不变。

| 整理前 | 整理后 | 当前文件 |
|---|---|---|
| `59` | `58` | `58-devlog-f9.3-roadmap.md` |
| `60` | `59` | `59-devlog-f9.4-agent-profile-binding.md` |
| `61` | `60` | `60-devlog-ci-pr-flow.md` |
| `62` | `61` | `61-devlog-f9.5-main-agent-planning.md` |
| `63` | `62` | `62-devlog-f9.6-workspace-resource-handoff.md` |
| `64` | `63` | `63-devlog-f9.7a-project-runtime-core.md` |
| `65` | `64` | `64-devlog-f9.7b-human-control.md` |
| `66` | `65` | `65-devlog-f9.7c-runtime-recovery.md` |
| `67` | `66` | `66-devlog-f9.8-longterm-acceptance.md` |
| `68` | `67` | `67-devlog-bug-tracking.md` |
| `70` | `68` | `68-bugfix-bug-001-004-longterm.md` |
| `71` | `69` | `69-interview-longterm-bugs.md` |
| `72` | `70` | `70-devlog-resource-access-rename.md` |
| `73` | `71` | `71-devlog-f9.9a-project-query.md` |
| `74` | `72` | `72-devlog-f9.9b-human-control.md` |
| `75` | `73` | `73-devlog-f9.9c-project-follow.md` |
| `76` | `74` | `74-devlog-f9.10-goal-confirm.md` |
| `77` | `75` | `75-devlog-f5-2-project-entry.md` |
| `78` | `76` | `76-bugfix-bug-005-unknown-tool.md` |
| `79` | `77` | `77-bugfix-bug-006-malformed-tool-name.md` |
| `80` | `78` | `78-devlog-f10-0-design.md` |
| `81` | `79` | `79-devlog-f10-1a-project-persist.md` |
| `82` | `80` | `80-bugfix-bug-008-shell-cancel.md` |
| `83` | `81` | `81-devlog-f10-1b-roadmap-persist.md` |
| `84` | `82` | `82-devlog-f10-1c-mailbox-resource-persist.md` |
| `85` | `83` | `83-devlog-chatgpt-provider-research.md` |
| `86` | `84` | `84-devlog-model-protocol-design.md` |
| `87` | `85` | `85-devlog-m1-1-protocols.md` |
| `88` | `86` | `86-devlog-m1-2-responses.md` |
| `89` | `87` | `87-devlog-f10-1d-recovery-isolation.md` |
| `90` | `88` | `88-devlog-f5-project-plan.md` |
| `91` | `89` | `89-devlog-m1-3-chatgpt-auth.md` |
| `92` | `90` | `90-devlog-f5-3-workspace.md` |
| `93` | `91` | `91-devlog-m1-4-openai.md` |
| `94` | `92` | `92-bugfix-bug-009-namespace.md` |
| `95` | `93` | `93-devlog-f10-2-session.md` |
| `98` | `94` | `94-devlog-f10-3-interruption.md` |
| `99` | `95` | `95-bugfix-bug-010-roadmap-schema.md` |
| `100` | `96` | `96-devlog-f10-4a-done-signal.md` |
| `101` | `97` | `97-devlog-f10-4b-main-review.md` |
| `102` | `98` | `98-devlog-f10-5-rework-loop.md` |
| `103` | `99` | `99-bugfix-bug-011-restart-order.md` |

## 关键决策

- **重排编号**：曾考虑“编号不变、空号复用”以避免大批改名，用户最终决定重排，保持编号连续并与原规则一致。代价是 Git 历史、PR 描述和对话中的旧编号与旧路径失效，需借助上方对照表查找。
- **已占用的 19、20、30 不再移动**：它们填补的是重排前已存在的空号，移动会让 21 号之后几乎所有文档再改一次编号。
- **合并文档中的“原 N”**：合并文档正文里的“原 30 / 58 / 69 / 96 / 97”是整理前编号，用于说明来源，不随重排改写。
- **只做组织调整**：合并文档逐段原样保留，只降级标题层级并把指向旧文件的链接改为“本文第 N 节”；计划压缩时删去的完成标准细节仍可在对应开发记录和 Git 历史中查到。

## 坑与发现

- 原 `index.md` 中 F10.2–F10.5、BUG-009/010/011 与 M1.3/M1.4 都错放在“研究与自动审查”一节，按阶段查找时会漏掉。
- `bug-plan.md` 的 BUG-006 行含真实换行符，Markdown 表格在该行断开。
- 正文里不带链接的编号引用无法自动改写；本次检出 57 号记录中的“62 号记录”已改为链接，其余数字核对为测试数量等非文档编号。

## 下一步

新文档按 AGENTS.md 取已有最大编号加一，当前下一个编号为 100。
