# F5.4 Main 对话与项目状态跟随（带缺口合并）

## 做了什么

- 接通项目 Main 回合与 `project.follow` 的 Electron Bridge：ProjectController、preload 校验、项目事件转发和取消清理。
- ProjectRuntime 作为当前运行期间的项目状态所有者，处理早到事件、晚到回执、follow 失败重连、StrictMode 重入订阅和项目切换隔离。
- ProjectConversation 使用受控 Composer 和单一 history，项目标题 / 目标与消息共用滚动区；关闭项目只释放观察，重开可重新附着。
- 合并 master 时保留 F7.1 / F7.2 的资料库入口与项目级资料操作：`ProjectWorkspace` 同时接收 `api / resource / runtime`，`App` 与 `Detail` 透传两者。
- 受控 QA 覆盖双项目、预填 / 空目标、明确确认后两节点规划、切换 / 关闭重开、恢复、停止和 547px 窄屏。

## 关键决策

- Main 对话状态由 `ProjectRuntime` 持有，不复制聊天 reducer；Resource 操作仍由 F7.2 的项目级 owner 持有，两者生命周期分开。
- 项目事件与资源事件按各自 subscription 隔离；关闭面板只取消对应观察，不取消另一类操作。
- 合并 master 时以现有 F5.4 会话面板为主，叠加 F7.1 / F7.2 的资源按钮、资料库弹窗和操作 owner；不删除任一侧能力。

## 授权与边界

2026-10-27 用户明确允许在 BUG-036 未修复、真实 Main 未验收的情况下直接合并 PR #111。授权范围仅限本次合并：

- F5.4 在计划中保持 🔄，不标记完成。
- BUG-036 保持未勾选、未关闭。
- 后续仍须在新的隔离库完成预填与空目标两条真实 Main 路径；本次授权不构成后续豁免。
- 用户要求直接合并，因此未等待合并后 PR 当前 head CI 完成；合并前本地完整前端检查与受控 QA 已通过，真实模型未调用。

## 验证

- 合并 master 后前端 `pnpm typecheck` 通过。
- 前端 32 个测试文件 / 184 项通过。
- `pnpm build` 通过。
- 受控 Electron QA `status=passed`：5 个用户回合，547px 下 `scrollWidth=547`，无横向溢出。
- `git diff --check` 通过。
- 真实 Main 两回合未运行；真实模型和真实 Host 认证结果仍未验收。

## 后续

在干净出口与真实模型预算确认后，按 F5.4 完成标准跑预填 / 空目标两条路径；通过后把 F5.4 改为 ✅ 并关闭 BUG-036，再开始 F5.5。
