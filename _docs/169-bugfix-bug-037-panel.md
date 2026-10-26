# 169：BUG-037 窄屏项目会话面板极窄

日期：2026-10-27。状态：已在独立 master 分支复现并修复，本机、实际 Renderer 与当前 head CI 验证通过，PR #112 已合入，关闭。

## 现象与复现

F5.4 实际 Electron 几何验收发现，547px 窗口的项目会话面板宽度约 2px（left=533/right=535），输入框宽度约 4px，原先仅检查 DOM 存在和页面无横向溢出的脚本误判可用。修正分支中的媒体查询列定位后，面板恢复为 350px（left=185/right=535），输入与实际鼠标操作可用。

## 已证实事实与根因假设

分支已实测窄屏绝对定位 aside 仍指定 grid-column:2，而父布局已变为单列。当前 master 保留同一定位规则，独立 master 运行对照现已复现，具体数据见下节；初始登记时尚未完成的证据边界保留在本次推进事实中。DOM 提交与绘制命中树的短暂不同步另属 QA 观察时机，不通过增加生产 z-index 或 pointer-events 补丁掩盖。

## 修复内容

独立分支 `fix/bug-037-panel` 从最新 master 建立，首先在未修改 CSS 的原布局实际复现。唯一生产改动为 `frontend/src/workspace/project/workspace.module.css` 的 <=820px 媒体查询：将 panel 的 grid-column 设为 1，保留 grid-row:1/4。单列布局下绝对定位面板改以实际第一列作为包含块，不再定位到不存在的第二列。宽屏仍保持原第二列并排布局；未改 z-index、pointer-events、isolation 或 F5.4 功能。

新增 `frontend/scripts/qa/bug037.cjs` 管理单个 Electron QA 窗口，等待两帧绘制稳定后测量 geometry / hit-test，再用 sendInputEvent 实际鼠标操作验证收起、恢复、完全展开、Node 选择及草稿保持。before 模式只采集基线失败，after 模式验证实际交互；不把 DOM 存在或页面无横溢出当成控件可用。

## 验证结果与边界

Node24.22.1 / Windows PowerShell。主线独立对照中窗口外宽547px、Renderer viewport531px：修复前 panel x517/width2、textarea width4，gridColumn=2；修复后 panel x169/width350、textarea width294，gridColumn=1，scrollWidth=531。完全展开宽495px，宽屏viewport1304px下 panel宽400px。Node选择、原生收起 / 恢复及跨收起重开的草稿保持通过，主编排已查看截图和结果 JSON。

前端 node/web 类型检查、生产构建、28 文件 / 165 项测试通过。首次缺根 tsx 依赖造成3项失败，按冻结锁补齐依赖后使用明确 Node24 完整复验通过，未修改清单或锁文件。主编排根包类型检查、完整 all 模式171文件 / 1080项通过（255.71秒），含进程恢复。`git diff --check` 通过。

证据在本会话 `bug037/before` / `after`（含 narrow / expanded / restored / wide PNG及results.json），根完整日志为 `bug037/root-full.log`。[PR #112](https://github.com/likeWind221/Navo/pull/112) 最终 head `72da17c` 的 CI run `40367528661` 成功（verify 3m29s），已 squash 合入 master（`ec14333`）。rebase 只合并两段独立交接记录，前端生产与 QA 内容未变。F5.4 的真实认证门禁仍由 BUG-036 跟踪，不能用本项修复替代。

## 后续

确认工作树干净、PR 已合并后清理专用工作树及本地分支。继续 F14.3a 独立后端交接；F5.4 保留 Draft 和未通过的真实认证门禁。跟踪入口：[Bug 计划](bug-plan.md)。
