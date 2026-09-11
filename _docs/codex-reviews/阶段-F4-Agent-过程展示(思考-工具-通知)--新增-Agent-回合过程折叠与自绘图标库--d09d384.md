# Git Commit d09d384（feat: add chat process fold and icon library for F4）— 阶段 F4：Agent 过程展示（思考 / 工具 / 通知）

## 🟠 Medium（警告）

### [Bug] 生成中点击过程行标题会让回合结束后永久失去自动折叠
位置：frontend/src/workspace/chat/process/Row.tsx:24
**问题：** `onClick` 无条件翻转 `userExpanded`，而 `expanded = !folded || userExpanded`（第 14 行）让生成期间的这次点击没有任何可见效果；但它已经把 `userExpanded` 置为 true，回合结束后 `folded` 变为 true，该行因此保持展开。开发记录写的是“等待与生成阶段点击标题不会收起内容，只有回合结束后用户才能折叠与展开”，实现与此不符。
**影响：** 用户在生成中随手点一下标题（按钮此刻 `aria-expanded=true`，看起来可切换），回合结束时过程就不会按 F4.2 的核心行为折叠成“已处理 Ns”一行，必须再点一次才收起。`qa/process.cjs` 在生成中连点两次恰好抵消了这个副作用，因此单元测试与桌面验收都无法发现。
**建议：** 让生成期间的点击无副作用，例如 `disabled={!folded}` 或 `onClick={() => { if (folded) setUserExpanded((current) => !current); }}`；同时把 `qa/process.cjs` 中生成中的点击改为只点一次，再断言回合结束后仍然折叠。

## 🟡 Low（建议）

### [Bug] 流式判定由内容块状态退化为行/消息状态，异常结束时流式光标不复位
位置：frontend/src/workspace/chat/process/Row.tsx:31
**问题：** 折叠前传给 `AssistantBlock` 的 `live` 是 `!folded`，而改造前是 `active && block.status === "streaming"`（`List.tsx` 的 `isTurnLive(message.status)` 现在只用在最终回答上）。当回合在未补发 `content-completed` 的情况下进入终态（Host 崩溃或连接断开触发的 `turn-error`/`bridge-error`；`src/agent/output.ts` 的 `finish()` 正常路径会先补发），`final === null` 因而不折叠，仍在 `streaming` 的思考块会一直显示“思考中”与闪烁光标。对称的瞬时问题是 Host 先发最后一块文本的 `content-completed`、再发 `turn-completed`，中间那次渲染把已完成正文档当作流式内容（`List.tsx:79` 的 `streaming={live}`），F3.11 的公式语法短暂回退为 `$x$` 字面量。
**影响：** 思考中途回合异常结束时，过程行里的思考块永久停留在“思考中”并持续闪烁，属于 F3.4/F3.6 已验收行为的回归；完成瞬间最终回答的公式会先以字面量渲染再切换。
**建议：** 把回合活性而不是折叠结果透传给内容块：`ProcessRow` 增加 `live` 参数并传 `live={isTurnLive(message.status)}`，块内继续用 `live && block.status === "streaming"` 判定；最终回答改为 `streaming={live && content.final.status === "streaming"}`。

### [测试缺口] 桌面验收记录了横向溢出却从未断言
位置：frontend/scripts/qa/process.cjs:144
**问题：** 快照收集了 `overflow`（第 59 行：`article.scrollWidth > article.clientWidth`），但整个脚本没有任何断言使用它，也没有像 `icons.cjs` 那样做窄窗口复测。F4.2 的完成标准明确要求“Electron 验收确认折叠体不可见、展开后可读且无横向溢出”，`frontend-plan.md` 据此把 F4.2 标为 ✅。
**影响：** 长工具参数或长通知把助手消息撑出横向溢出时 `pnpm --dir frontend qa:process` 依然通过，验收标准中唯一没有自动断言的一项会静默失效。
**建议：** 在现有断言后补 `assert.equal(streaming.overflow, false)`、`assert.equal(folded.overflow, false)`、`assert.equal(expanded.overflow, false)`，并仿照 `icons.cjs` 在 `window.setSize(560, 720)` 后重新取快照断言。

### [契约一致性] 本次新增的 5 篇 F4 文档没有登记进文档索引
位置：_docs/index.md:62
**问题：** 提交新增 `_docs/49-devlog-chatgpt-codex-ui-research.md`、`_docs/50-process-ui-design.md`、`_docs/51-devlog-f4-1-icons.md`、`_docs/53-devlog-icon-library-research.md`、`_docs/55-devlog-f4-2-process-fold.md`，但 `_docs/index.md` 的“前端记录”段落仍止于第 62 行的 F3.11，索引中查不到任何 F4 条目。
**影响：** 项目约定要求每完成一个步骤同时完成“写开发记录 + 在 index.md 登记 + 更新计划状态”，缺一即视为该步骤未完成；当前计划把 F4.1/F4.2 标为 ✅，但只读索引的人找不到 F4 的调研、实施方案与开发记录。
**建议：** 在 `_docs/index.md` 的“前端记录”段落补齐这 5 行（F4.1、F4.2 开发记录，F4 过程 UI 实施方案，两份调研），与 `frontend-plan.md` 的 F4 状态对应。

### [契约一致性] “当前下一步”在同一计划文档内自相矛盾
位置：_docs/frontend-plan.md:205
**问题：** 本次提交在第 199 行新增“当前推进 F4.3 流式过程标题与用时 … F4.3–F4.4 未开始”，同时把第 205 行的旧句改写为“F3 之后的前端阶段已由 F4 承接，当前下一步为 F4.1”，而同一提交已把 F4.1、F4.2 标为 ✅。
**影响：** 计划是后续 Step 执行的单一事实源，同文档两处冲突会让接手者误判当前应执行 F4.1 还是 F4.3，也影响后续步骤状态的核对。
**建议：** 把第 205 行改为与第 199 行一致的表述（例如“前端阶段当前为 F4，下一步 F4.3”），或删除这句已被上层段落取代的话。
