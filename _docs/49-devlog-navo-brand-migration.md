# Navo 品牌迁移记录

## 做了什么

- 项目品牌从 SkillWorld 迁移为 Navo。
- 根包、前端包和 RPC scope 迁移为 `navo`、`navo-frontend`、`@navo/rpc`。
- 应用级标识 `SkillWorldApp` / `SkillWorldAppConfig` 迁移为 `NavoApp` / `NavoAppConfig`。
- Host 与 QA 的项目环境变量统一由 `SKILLWORLD_*` 迁移为 `NAVO_*`。
- Electron IPC channel 前缀由 `skillworld:` 迁移为 `navo:`。
- 桌面 title、wordmark、HTML metadata 迁移为 Navo。
- 新增 Navo 当前 PRD；原 SkillWorld PRD 归档为历史设计。

## 关键决策

品牌名称只进入项目身份边界，不污染通用技术抽象。`AgentRuntime`、`SessionStore`、`LLMService`、`ToolService`、RPC、Tool 等名称保持职责导向，不改成 `NavoRuntime` 一类品牌前缀。

当前 Learning 领域的 `Node`、`NodeSession`、Content 等模型也没有机械改名。它们属于 Phase 9 之前留下的领域实现，后续应根据 Adaptive Roadmap 的真实领域模型决定保留、适配或替换。

历史 Phase 0–8 开发记录保留 SkillWorld 名称，避免篡改项目演进事实。

## 坑与发现

首次品牌提交中误把 `frontend/package.json` 的 `micromark-util-symbol` 从 `2.0.0` 写成 `2.1.0`。后续提交立即恢复，品牌迁移不包含依赖升级。

GitHub 远端仓库名仍需从 `SkillWorld` 改为 `Navo`；该动作不属于源码树内容变更。

## 下一步

品牌迁移完成后进入 Navo Phase 9：Adaptive Roadmap Runtime。该阶段再处理 Roadmap Node、Relation、Scheduling、Replanning 与现有 Learning `Node` 模型之间的领域边界，不在本次 rename 中提前重构。
