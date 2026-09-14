# 源码目录与命名重构实施记录

## 做了什么

按用户确认的顺序完成后端 → RPC → 前端 → 测试与脚本重构，执行 77 条一对一路径映射，另拆分 RPC 传输实现和桌面共享契约；所有手写源码、测试与脚本文件名均不再含连字符。命名与目录偏好已记入 CLAUDE.md，原先建议连字符文件名的例子同步替换。

- 后端：Host、Qwen、NodeSession、Exa、Fetch 子模块目录归位，入口和所有消费者同步迁移。
- RPC：stream.ts 保留公共类型，stream/{client,server,router,queue,validation}.ts 分别管理客户端流、服务端任务、方法注册、队列和校验器创建；content 下收纳校验、状态机与测试；failure.ts 消除 Notification 对内容模块的依赖。
- 前端：shared/agent.ts 及其 validation/errors/channels 作为 Main、Preload、Renderer 共用契约；Host/IPC/Preload 子模块归位；Chat/Shell 及 chat 下的视图、reducer 与 Hook 使用简短文件名。
- 测试：根测试按 agent/llm/session/node/tools/host/integration/protocol 归类；RPC 通用流、业务集成和通知测试分目录但保留断言；前端 shared 测试显式纳入类型和测试发现。
- 脚本：scripts/host/mock.ts、search/smoke.ts、fetch/smoke.ts；前端 scripts/qa/{static.cjs,chat.ts}，构建 QA 产物改为 out/main/chat.js，qa:f2-6 命令键保持兼容。

## 关键决策

本次改变文件归属与依赖路径，不改变 RPC 方法、IPC 通道字符串、导出业务类／函数名称、模型行为和 CSS 规则。状态仍由原来的对象拥有，Client 队列和 Server 活动任务分别封装；共享校验器工厂只做输入绑定。短协议和错误文件保留独立边界，不增加目录级转发 index.ts。

现有 command.ts 和命令测试保持兼容，没有借文件重构删除功能，也没有新增命令实现或通知订阅。用户要求的 Notification 优先范围收敛应作为下一项独立修改，明确替换通知实际传输出口后再调整 F3 计划。

## 坑与发现

- 测试目录加深后，frontend/electron/host/tests/process.spec.ts 中基于 import.meta.url 的仓库根需同步上移一级；普通 import 替换不能覆盖它。
- QA 构建配置的 scripts 路径按 frontend 工作目录解析，而不是相对配置文件 import。首次生产构建暴露旧 QA 入口遗漏，修正为 scripts/qa/chat.ts 后构建通过。
- Mock Host readyMarker 是运行协议字符串，保留原内容；测试中的脚本路径正则必须迁到 scripts/host/mock.ts，二者不能一起机械替换。
- 实际 main 入口冒烟脚本最初在正文占位节点尚不存在时读取 p.textContent；改为可空等待后通过，未修改产品代码。

## 验证

| 检查 | 结果 |
|---|---|
| 根 pnpm typecheck / pnpm test | 通过，28 个测试文件、198 项 |
| RPC tsc / Vitest | 通过，6 个测试文件、42 项；拆分前后用例数一致 |
| 前端 typecheck / test | 通过，9 个测试文件、38 项 |
| 前端生产 build | 通过，main/preload/renderer 与 QA 入口成功输出 |
| pnpm --dir frontend qa:f2-6 | Electron Mock 全链路通过：中文输入法、流式、完成、停止、滚动保护、窄窗口及关闭清理 |
| 真实 Electron main 入口冒烟 | main → preload → production renderer → Mock Host 成功收到回复 |
| Electron 开发预览 | ?preview=design 动态加载 Sample.tsx 成功 |
| 路径与命名检查 | 77 个迁移源均移除，旧运行路径无残留；源码／测试／脚本无连字符文件名 |

合计 278 项测试通过。Mock QA 中流式阶段收到 160 字符，完成 2220 字符，取消保留 120 字符；向上阅读后 scrollTop 保持 0，560px 窄窗无横向溢出，并检查生成的窄窗截图。没有重新调用真实 Qwen 服务；本次以保留断言的测试、Mock Host 与桌面构建验证结构兼容。临时开发服务与验证窗口已经关闭。

QA 证据：frontend/qa-output/f2-6-results.json、f2-6-desktop.png、f2-6-narrow.png。临时迁移和入口冒烟脚本位于系统临时目录，不加入生产工程。

## 下一步

确认 Notification 优先的功能范围与独立出口，再推进后续 F3 接入。本次不自动开始后端事件出口或新的前端界面。历史开发记录保留当时的路径，当前计划、进度及架构审核更新为实际目录；完整旧新映射见 [目录整理方案](23-structure.md)。
