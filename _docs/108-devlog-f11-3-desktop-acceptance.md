# F11.3：桌面公共契约独立验收

> 日期：2026-10-16；基线：master `e1afdcf`。
> 状态：🔄 本机检查与 Electron 最终复验通过，当前 PR head CI 待收口。

## 做了什么

前端独立验证 F11.3 已交付的 `window.desktop.project.autoRunStart/Pause/Resume/Get`。修复验收中发现的 [BUG-013](107-bugfix-bug-013-autorun-desktop.md)：四个公共错误码遗漏页面提示，以及四项 AutoRun 测试未被默认发现。

新增 `frontend/scripts/qa/autorun.ts`，作为 Electron 专用验收入口，接入正式构建、预加载桥与 IPC 注册；通过已有 Mock Kernel Host 的真实 Project/AutoRun 服务运行，不在 Renderer 导入后端私有实现。

## 关键决策

- 本次验收是公共契约实际调用，不新增正式 Renderer 自动运行控件。正式页面目前无开始/暂停/恢复按钮，不能把 bridge 通过写成产品 UI 交互通过；F5.4–F5.8 状态不变。
- 用独立临时数据库和 Workspace，模型选择固定为 mock，无远程调用、付费模型或现有项目变更。
- 通过公共 `project.turn.v1` 建立两个节点的计划；Mock 响应队列耗尽后产生预期模型失败，真实 Runtime 按默认五次模型重试后以 `turn-failed` 暂停。因此轮询等待上限为 45 秒，未修改生产重试或预算。
- 验收覆盖空运行、四种 AutoRun 错误、启动立即返回 running、回合内暂停请求仍返回 running、失败后的 target/reason/计数、重复暂停、恢复新 runId/预算、全部 skip 后完成与 get=null。
- 完成夹具使用公共 review 接口显式 skip 两个节点；跳过上游会改变下游版本，逐次重读版本再提交。它只证明 completed 的桥接语义，不是模型完成工作的证据。
- 本次没有设计 Agent 协议或修改取消语义，不修改后端，不新增 Harness 对齐工作，不开始 F12。

## 坑与发现

- 修正前前端默认 135 测试通过，但 web typecheck 失败；修正后 node/web typecheck、22 文件 139 测试和生产构建通过。原四项测试现在由 `.spec.ts` 发现。
- 根目录完整 typecheck 和 112 文件、695 测试通过，46.22 秒。运行使用 bundled Node 24.19.0；Electron 使用 44.2.0 / Node 24.20.0。
- 验收脚本显式处理 window-all-closed，保证关闭窗口后完成异步资源清理并输出正确退出码；失败写入 failure.json，避免仅凭窗口消失判断通过。
- 初轮 10 秒等待不足以覆盖默认重试；另一次夹具使用旧下游版本被正确拒绝。失败现场分别保留在本机 Temp 的 `navo-f113-desktop-acceptance-20261016/failure.json`、`navo-f113-desktop-acceptance-20261016-final/failure.json`。
- 截图尝试遇到 `Current display surface not available for capture`，已保留 `navo-f113-desktop-acceptance-20261016-passed/failure.json`；本次契约验收不依赖截图，不作为视觉验收。
- 本机检查命令使用各工程 `node_modules/typescript/bin/tsc` 与 `node_modules/vitest/vitest.mjs run --maxWorkers=4`，构建使用 `node_modules/electron-vite/bin/electron-vite.js build`。Electron 入口为 `frontend/node_modules/electron/dist/electron.exe out/main/autorun.js`，工作目录为 frontend。

## 下一步

最终 Electron 退出码 0，断言全部通过，成功证据为 `C:/Users/likeW/AppData/Local/Temp/navo-f113-desktop-acceptance-20261016-contract/result.json`。失败与成功证据分开保留。本次覆盖回合内暂停请求、已暂停幂等操作；`human-paused` 回合边界收口由已有后端测试覆盖，本次没有用成功模型回合重验。

等待当前 PR head CI 后关闭 BUG-013、完成 F11.3 公共契约收口。F12 只进入可规划状态，不自动实施。

本次授权范围为前端验收及阻塞它的最小修正；共享计划与索引由当前 Agent 唯一串行维护。代码导读在最终交付提供。
