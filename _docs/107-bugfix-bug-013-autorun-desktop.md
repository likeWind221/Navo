# BUG-013：AutoRun 桌面验收阻塞

## 现象与复现

2026-10-16，基线 master `e1afdcf`。Frontend web typecheck 在 `projectFailureMessage` 报 TS2366；默认前端测试 21 文件、135 项通过，但不包含 AutoRun handler 测试。

跟踪：[bug-plan.md](bug-plan.md)。本次由当前 Agent 串行维护共享计划与索引，只修改前端能力和验收记录，不修改后端生产实现。

## 已证实事实与根因假设

- 公共错误联合已加入四个 AutoRun code，但 Renderer 的穷尽 switch 没有对应分支，类型检查失败。
- AutoRun 测试使用 `handler.test.ts`，而 `frontend/vitest.config.ts` 只发现 `.spec.ts`，因此默认检查漏跑四个已有场景。
- `frontend/src` 尚无 AutoRun 控件；F11.3 的实际交付范围是公共 API 与 Electron bridge，不能据此声称正式页面按钮已验收。

## 修复内容

补齐四个错误提示，将已有测试移为 `autorun.spec.ts`。新增独立 Electron 验收入口，通过正式 preload / IPC 和 Mock Kernel Host 的真实领域服务验证公共契约；不修改后端或新增正式页面功能。

## 验证结果与边界

修正后前端 node/web typecheck、22 文件 139 项测试、生产构建通过；根目录 typecheck、112 文件 695 项测试通过。Electron 44.2.0 实际 preload/IPC/Host 调用断言全部通过，退出码 0，详见 [108](108-devlog-f11-3-desktop-acceptance.md)。修复前结果与验收夹具失败现场均保留，不能计为通过。

正式页面尚无 AutoRun 控件；这次不证明视觉交互。未调用真实模型，完成状态由 Human skip 夹具产生；真实模型自动完成证据沿用 F11.4。

## 后续

代码 head `a6859a8` 的 [CI verify](https://github.com/likeWind221/Navo/actions/runs/38907912137) 已成功，93 秒；[PR #71](https://github.com/likeWind221/Navo/pull/71)。本机与 CI 达到本项关闭条件，BUG-013 关闭；收口文档提交仍执行当前 head CI 门禁。F12 未开始。
