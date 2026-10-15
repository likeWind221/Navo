# F10.5 F10 长程集成验收

## 做了什么

- **离线完整场景**（`tests/integration/rework.spec.ts`，模型脚本见 `tests/integration/rework/script.ts`，打开与重启工具见 `tests/integration/rework/helpers.ts`）：一个 Project 依次经过以下 10 个回合，中间两次关闭 App 后用同一个 SQLite 文件重新打开：
  1. Main 规划 evidence → synthesis；
  2. evidence 发布草稿并 `submit_completion`，进入 `submitted`：不能再启动，下游不解锁，等待复盘；
  3. Main 复盘时打开草稿发现没有来源，判 `rework` 并附意见：节点回到 `idle`，返工 1 次，意见等待送达；
  4. **第一次重启**：Project、Workspace 绑定、Roadmap、节点、资源、Mailbox 和两个会话的事件全部与重启前一致，复盘状态不变；
  5. evidence 续接原会话，第一条请求带着返工意见，发布带来源的文件后重新提交；
  6. Main 先看工作日志、再打开产物，判 `complete`，然后在同一回合用 `modify_roadmap` 加入 validation，并让 synthesis 依赖它（Roadmap 版本 3）；
  7. 请 Main 复盘从未执行的 validation：判 `complete` 被拒绝，改为 `escalate`，节点不变；
  8. validation 执行并提交，Main 复盘判完成，再把两份资源共享给 synthesis；
  9. synthesis 读取共享资源后提交；
  10. Main 复盘判完成。
  **第二次重启**后再比对一次，并要求：三个节点都由 Main 判定完成、节点与 Roadmap 的快照等于事件重放的结果、每个会话的回合都开始且结束过一次、全程只有一次预期的工具失败（`never-ran`）、mock 模型脚本恰好用完、两次重启后没有自动发起模型请求。
- **真实模型验收脚本**（`scripts/rework.ts`，`gpt-6-sol`）：流程与离线场景相同，包括两次重启，逐回合把证据写入 `NAVO_EVIDENCE_DIR` 或临时目录，失败时写 `failure.json`。按用户决定，规划由 Main 自己调用 `create_roadmap` 完成，不绕开 BUG-010。各回合断言判定结果，不断言文字：草稿必须被返工；补做后必须由 Main 判完成，并在同一回合新增恰好一个工作节点、让 synthesis 依赖它；从未执行的节点不能被判完成；最终三个节点都由 Main 判定完成。
- `scripts/acceptance.ts` 允许脚本另选订阅模型，默认仍是 `gpt-6-luna`，已补测试。`scripts/longterm/evidence.ts` 的状态快照增加作业单、待送达意见、最近复盘、确认人和返工次数。`tests/integration/longterm/script.ts` 导出模型脚本小工具供新场景复用，原场景不变。
- 本 Step 不改生产代码和公共契约。

## 关键决策

- **重启方式**：在同一进程内关闭 App，再用同一个数据库文件新建 App。状态全部从磁盘重新读出，不经过内存；跨进程的 Host 重启已由 `tests/host/process.spec.ts` 覆盖，不再重复。
- **按会话切换脚本**：重启时新的 mock adapter 从上一次已消费的位置接着取脚本，节点 ID 和资源 ID 由脚本从工具结果中取出再回填。这一做法参考 DeepSeek Harness 的 `packages/test-support/llm-replay/README.md`（按会话编排脚本、用 `{{fromRequest:...}}` 从请求回填运行时 ID）。不采用它“录下真实会话再回放”的 fixture：真实运行只保留证据，避免模型输出一变离线测试也跟着变。
- **比对时忽略列表顺序**：重启前后比较节点和资源时按 ID 排序，原因见下面的 BUG-011。其余内容（含会话事件顺序）严格比对。BUG-011 修复后已改回严格比对（[103](103-bugfix-bug-011-restart-order.md)）。
- 测试超时设为 20 秒：单独运行约 0.7 秒，全量并发时超过了默认的 5 秒。

## 坑与发现

- **BUG-011**：重启后 `getByProject` / `listByProject` 的顺序从创建顺序变成了 ID（UUID）顺序，原因是恢复时按 `owner_id` 排序读取事件。会影响资源列表 RPC、Main 的项目事实和节点可见资源的展示顺序。已登记，本 Step 不修，见 [103](103-bugfix-bug-011-restart-order.md)。
- 脚本中的 `call(...)` 在构造时就要求 ID，引用后面才产生的 ID 时必须用 `step(() => call(...))` 延后求值。
- 本机当前只有 Node 22.23.1（`engines` 要求 ≥ 24，只是警告），`node:sqlite` 可用。新 worktree 需先执行 `pnpm install --frozen-lockfile`。

## 验证

- `pnpm typecheck` 通过；`pnpm test` 107 个文件、665 项全部通过（PowerShell，Node 22.23.1）。
- 新场景与原 longterm 场景连续跑 5 次全部通过，未出现不稳定。
- **真实模型验收（2026-10-15，经用户同意，`gpt-6-sol`）：未通过，停在规划阶段。**
  - 凭据：第一次检查时刷新令牌返回 `invalid_grant`，用户重新执行 `pnpm chatgpt login` 后，模型列表中有 `gpt-6-sol`。
  - `01-confirm`（约 26 秒，2 步）：Main 读取 Roadmap，复述目标和两个节点并请求同意，没有提前规划，符合预期。
  - `01-plan`（约 160 秒，16 步）：15 次 `create_roadmap` 都给 work 节点带上 `control: "checkpoint"`，全部被拒；回合在 16 步上限处 `blocked`。这就是 BUG-010，记录追加在 [99](99-bugfix-bug-010-roadmap-schema.md)。
  - 后续回合（交作业、返工、两次重启、Main 判完成和改计划）都没有执行，F10.4b 的真实场景也因此仍未验证。证据在本机 scratchpad 的 `rework-run1/`（未入库）。
  - 因此 F10.5 保持 🔄。

## 下一步

- 真实验收被 BUG-010 阻断：先修 BUG-010 再重跑 `scripts/rework.ts`；或者经用户决定，由脚本直接写入初始 Roadmap 以绕开规划阶段。通过后把 F10.5 和 Phase 10 标为 ✅。
- BUG-011 已在 `fix/bug-011-restart-order` 修复（[103](103-bugfix-bug-011-restart-order.md)）。
