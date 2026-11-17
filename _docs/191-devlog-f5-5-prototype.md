# F5.5 路线展示：原型确认与正式接入

## 做了什么

- 仅新增 `frontend/f55.html`、`frontend/src/preview/f55/{main.tsx,model.ts,style.css}` 与 `frontend/scripts/demo/f55.mjs`。复用既有 Shell、Icon 和三维地图场景；未改正式入口、生产组件、后端或共享协议。
- 网页展示六种状态、必选/可选、节点目标、完成标准、前后依赖与可用操作信息；依赖列表可跳转节点。执行操作仅显示，不执行。
- 预览场景支持状态推进、增删节点、修改依赖、连接中断/恢复、清空和恢复；均为本地示例数据，不调用模型。

## 关键决策

先确认网页原型再正式接入。桌面并排展示地图与详情，窄屏详情置于地图下方；保留原浮空岛视觉。原型文件待正式实现提取复用内容后删除，既有预览文件不属于本次清理范围。

## 验证与发现

前端 typecheck 通过。浏览器实际检查：汇合节点显示三个前置；调整依赖后变为两个；状态推进、增加/移除选中节点、空态与恢复、断线提示与重新连接通过。547px 下 document.scrollWidth=innerWidth=547，canvasCount=1；1280px 桌面与547px窄屏均已目视检查。该证据只证明原型交互，不代表正式后端跟随或 F5.5 完成。

## 下一步与清理

用户于 2026-11-17 明确确认“可以的就这样吧”，按已授权范围接入正式项目。本节以上为原型阶段事实；以下为正式交付。原型入口和启动方式已删除失效。


## 正式接入做了什么

- `Workspace.tsx` 复用现有 ProjectRuntime 跟随快照，将 requirement 传入地图、NodeV1 原样交给节点详情，显示路线版本与完成/跳过数量；同时读取 followFailure，在地图上提示观察中断。
- `Node.tsx` 与 `node/style.module.css` 展示只读节点事实。前后依赖从当前 Roadmap edges 计算，点击关系使用原 openNode 导航。可用操作逐项读取 actions，不能从 idle 状态推断 run 权限；submitted 只显示待验收。
- `Map.tsx`、map/model、island 与样式统一六种状态文字/符号/颜色；optional 标签可见；scene 的工作节点定位兼容当前执行中与原预览进行中文字。沿用既有增删、航线、布局和资源释放机制。
- 主面板继续提供 Main 对话及资料库，正式 Node 面板用详情替换占位草稿。窄屏 Node 详情位于地图下方，Main 保留既有覆盖式对话，完整展开仍可用。
- 持久回归放在 `scripts/qa/roadmap.ts` 与 `roadmap/`，受控公开快照驱动正式 ProjectWorkspace 与 ProjectRuntime，不挂载生产默认入口；electron-vite 增加 QA 入口，Vite / React 插件保留外部依赖；两个 tsconfig 纳入新验收文件。

## 关键函数与边界

NodeDetails 从 node / roadmap 计算前后节点 ID 及 actions 中为真的操作，输出只读信息；Relations 将相关 ID 解析为当前节点标题/状态并调用 onOpen。没有运行、确认或复盘的后端请求。Map 的重新连接按钮只调用已有 Runtime.reconnect，不启动模型。状态标签在 map/model 中统一转换，公共协议/后端未修改。

Node.tsx 是独立只读节点视图边界（少于40行但拥有其样式与测试）；没有为了行数合并到工作区。既有 scene.ts 及 runtime.ts 的原状态所有权不变，本次不扩展其生命周期。

## 正式验证

- 前端 typecheck、build 与 33 文件 / 187 项测试通过。新增测试覆盖 idle 但 run=false、submitted 不等于完成、当前依赖标题及 follow 整份替换不自动发起回合。
- 正式组件 Electron QA 通过：六状态、必选/可选、3→2 前置变化、标题与状态变化、6→7 节点、删除选中回 Main、观察中断与重新连接、清空/恢复、同一 Canvas、无隐式 Agent Turn、547px 无横向溢出、窄屏详情排列于地图下方。证据 `%TEMP%/navo-f55-qa/{result.json,wide.png,narrow.png}`，截图已目视检查。
- F5.4 受控 Electron 原流程回归 passed，证据 `%TEMP%/navo-f55-f54-regression/f5-4-controlled.json`；Main 两项目确认/规划、隔离、关闭重开、停止与窄屏通过。
- 后端 Node 24.22.1 typecheck 与 NAVO_TEST_MODE=all 完整 188 文件 / 1166 项通过（355.17秒，日志 `%TEMP%/navo-f55-full.log`）；本次不重新调用付费模型，不把受控状态变化称为真实模型行为验证。F5.4 原 DeepSeek 真实验收仍为此前证据。

## 清理与下一步

已删除本次独立原型五个文件：`frontend/f55.html`、`frontend/scripts/demo/f55.mjs`、`frontend/src/preview/f55/{main.tsx,model.ts,style.css}`，生产构建没有原型引用；既有 preview/Project 保留。仅保留可复跑正式组件的 QA 夹具，不保留原型控制器/重复样式。下一步为 F5.6a 节点执行，未开始。本机完整检查已通过；[PR #126](https://github.com/likeWind221/Navo/pull/126) 代码 head `f076683` 的 [CI 44037466017](https://github.com/likeWind221/Navo/actions/runs/44037466017) 复跑通过，verify 3m50s（类型、常规与崩溃恢复）。首轮CI两项后端测试超时保留为 [BUG-040/041](192-bugfix-bug-040-041-ci-timeouts.md)，仅排查、未修复。F5.5已登记完成，最终仅文档提交仍等待当前head CI后合并。

### 最终交接状态

代码head的成功不覆盖后续文档head失败：452477c的CI两轮未通过，最新7项后端测试超时（BUG-042）。当前F5.5恢复进行中，PR #126未合并；前端实现、本机187/1166与Electron结果仍有效。停止自动复跑，下一动作是后端测试/CI排查，不开始F5.6a；详见[192](192-bugfix-bug-040-041-ci-timeouts.md)。
