# 77：F5.2 真实项目入口

## 做了什么

- 桌面可创建真实项目：名称必填，目标可选，工作目录经系统对话框选择；侧栏展示真实项目列表；打开后在标签页查看名称、目标、工作目录、状态和创建时间。数据全部来自 Host 的 `project.list.v1` / `project.create.v1` / `project.get.v1`，正式入口不使用 Mock，也不伪造持久化。
- 桥接三层：`frontend/shared/project.ts`（`DesktopProjectApi` 与结果联合、失败码）+ `shared/project/{channels,validation}.ts`；Main `electron/ipc/project.ts`（ipcMain 注册与目录对话框）+ `ipc/project/handler.ts`（输入校验 → `KernelHostProcess.stream` → 错误映射，可脱离 Electron 单测）；Preload `electron/preload/project.ts` 挂到 `desktop.project`。
- Renderer：`src/workspace/project/` 下 `hook.ts`（useProjects 列表状态与创建后刷新）、`draft.ts`（表单预检）、`failure.ts`（失败码转中文）、`Create.tsx`（模态创建对话框）、`Detail.tsx`（打开时读取一次详情）、`Notice.tsx`（侧栏加载、失败、空态提示）；`App.tsx` 组合正式入口，`Shell.tsx` 新增 `create`、`notice`、`openRequest` 三个 prop。
- 阶段 ③ 目标可选：留空或仅空白时提交 `goal: null`，表单标签为“项目目标（可选）”并提示“可留空，之后在对话中与 Main 确认”；详情页 `goal=null` 显示“目标待确定”。
- 追加修复：标签栏隐藏原生滚动条但保留横向滚动，激活标签自动滚入可见区；两端按实际遮挡方向显示 28px 淡出（`data-overflow-start` / `data-overflow-end` + `mask-image`）。
- 新增 Electron 验收 `scripts/qa/project.ts`（`pnpm --dir frontend qa:project`，`NAVO_HOST_MODE=mock|real`）。

## 关键决策

- **结果联合而非异常**：四个方法均返回 `{type:"ok"} | {type:"failed"}`，失败需在表单和详情中可读展示，异常穿过 contextBridge 会丢失类型。选目录也统一为 `Result<string | null>`，`null` 表示取消。
- **Main 透传失败码，Renderer 统一转中文**：Host 的 11 个 `ProjectFailureCode` 原样透传；未知远端码归 `internal`；输出校验失败归 `invalid-output`；连接、启动等失败归 `host-unavailable`；Main 输入校验失败为 `invalid-input`，不调用 Host；Preload invoke 被拒为 `bridge-closed`。中文文案只在 `failure.ts` 穷尽 switch 中生成。
- **单结果读完整个流**：Main 读完流再取唯一结果，不在首项提前返回，避免触发 cancel 帧或跳过输出校验器的结束检查。
- **短请求不做取消**：list / create / get 为一次请求一次结果；窗口销毁后的回复由 Electron 丢弃，before-quit 注销 handler。
- **create 非幂等**：提交中禁用表单控件，并以 ref 防止渲染前的重复提交；提交中按 Esc 不关闭对话框。创建成功先把新项目插入列表再刷新，刷新失败也不影响打开；generation 计数丢弃过期的 list 结果。
- **项目面板仅在打开时挂载**：会话面板保持 F5.1 的常驻挂载以保留对话状态；项目详情只在标签打开期间挂载，因此只为打开的项目请求 get，重新打开会重新读取。不做实时跟随。
- **Shell 新增 prop**：`create` 按区段启用“新增”按钮，`notice` 按区段替代默认空态，`openRequest` 每次传入新对象即打开对应条目（创建成功后自动打开）。
- **标签栏渐变**：纯 CSS 无法判断遮挡方向，由 Shell 在 scroll / ResizeObserver 回调中直接写 DOM 属性（不触发重渲染），依赖 `[active, opened]` 重新注册并在清理时移除监听、断开观察。`scroll-padding-inline: 32px` 让激活标签及其关闭按钮落在 28px 渐变之外。

## 坑与发现

- 与后端 F9.10 并行开发：先按旧契约（goal 必填）完成阶段 ①，F9.10 PR 获批后 rebase 到 `phase9-f9.10-goal-confirm` 完成目标可选；F9.10 squash 合入 master 后再以 `git rebase --onto origin/master d7c95ed` 迁移。几次 rebase 均无冲突，前端经共享 `rpc/` 自动跟随类型与 parser。
- worktree 中 Electron 二进制下载失败，验收通过 `ELECTRON_OVERRIDE_DIST_PATH` 指向主仓库已安装的 Electron 44.2.0；根依赖缺失时 Host 进程测试会失败，需在根目录 `pnpm install --frozen-lockfile`。
- 真实 Host 启动和项目接口不需要模型配置；创建、列表、详情均不调用 LLM。
- 同一目录重复绑定返回 `workspace-conflict`；嵌套子目录可被另一项目绑定。

## 验证

- 自动检查：`pnpm --dir frontend typecheck` 通过；`pnpm --dir frontend test` 21 文件 / 134 项通过；`pnpm --dir frontend build` 通过。
- Electron 自动验收（Mock 与真实 Host 均通过）：空态提示；空表单提示“请填写项目名称”；取消选目录保留原选择；填写目标创建 → 列表 → 自动打开详情；同目录重复创建提示冲突；390px 关闭标签后从侧栏重开无横向溢出；不填目标创建显示“目标待确定”；3 标签窄屏无滚动条占位，激活最后一个时仅左端淡出，滚到最左时仅右端淡出；桌面宽度单标签两端无淡出。截图与结果见 `frontend/qa-output/f5-2-*`。
- 用户人工验收（2026-10-08，真实 Host，A–G 共 15 步）全部通过，包含原生目录对话框。

## 未覆盖边界

- 前端无组件交互测试库，Shell / Create 的交互逻辑由 Electron 验收覆盖，单测只覆盖纯逻辑与静态标记。
- 详情打开时读取一次，无实时跟随；不含项目内 Main 对话、Roadmap、Mailbox、Resource 与节点复核；无归档、删除、改名与持久化，Host 重启后项目清空。

## 下一步

- 下一前端 Step 待用户确认，候选为项目内 Main 对话接入；接入后才能在桌面体验 F9.10 的目标确认流程。
