# F5.4 DeepSeek 验收与项目独立预算

日期：2026-11-17。

## 做了什么

- F5.4 验收按 Project ID 分别累计用户回合与模型步骤，两类额度均为每项目 100；第 100 步可继续，收到第 101 步开始事件后请求取消。
- 用户回合发送前按对应项目检查额度，停止场景计入第一个项目；受控失败场景也读取对应项目的计数。
- 证据中的 budget 改为项目 ID 到计数及上限的映射；按用户要求不新增模型身份记录。
- 真实验收只在子进程清空旧 LLM_* 配置，显式设置 DeepSeek 官方地址、Flash、thinking=true 和 8192 输出预算。密钥从用户明确指定的 Magpie 本地登记读取，不输出、不提交；没有修改 Magpie 或用户全局环境。

## 关键决策

- 模型步骤按 turn-event 中可信 projectId 归属，跨项目切换和关闭重开不清零；不同项目不共享额度。
- 用户回合与模型步骤分别计数，避免工具续接被误算为额外用户回合。
- 本次复用同一桌面验收流程与判据。单回合 120 秒、总时限 15 分钟保持既有设置。
- main.ts 原本超过 300 行，本次保留同一文件：它是单一 Electron 验收入口，预算直接观察其窗口事件，没有新增独立生产状态机；不为本次预算调整拆分无关 UI 驱动。

## 坑与发现

- 默认 shell Node 为 22；后端完整检查使用应用内 Node 24.22.1，PATH 首项为 Windows System32。桌面 Host 由 Electron 自带 Node 执行。
- DeepSeek 路径不依赖订阅刷新，验收通过不代表 BUG-036 的 ChatGPT 认证故障恢复。

## 验证结果与边界

- 前端 typecheck、build、32 文件 / 184 项测试通过。
- 受控 Electron 场景 passed：预填 / 空目标、规划、切换草稿、关闭重开、停止和窄屏通过；两项目计数分别为 3/3 和 2/2，额度各 100，viewport=scrollWidth=547。
- 后端 Node 24.22.1 typecheck 与 NAVO_TEST_MODE=all 完整 188 文件 / 1166 项测试通过，359.49 秒；日志 `%TEMP%/navo-f54-full.log`。
- 真实 DeepSeek Electron 首轮在 Host 启动 10 秒处失败，未到模型回合；同期独立探针返回 host-already-running。完整测试结束后串行复验通过，未修改生产启动时限，BUG-038 保持未关闭，见 [笔记](170-bugfix-bug-038-host-startup.md)。
- 串行真实验收证据 `%TEMP%/navo-f54-deepseek-20261117-serial-evidence/f5-4-real.json`：status=passed；预填与空目标均在明确确认前无路线，确认后各生成恰好两节点；草稿隔离、关闭重开、停止、547px 窄屏通过。项目一用户回合 3 / 模型步骤 3，项目二 2 / 4；宽屏截图已目视检查，显示真实 Main 回复及两座节点岛屿。
- 实际入口：前端目录 `NAVO_HOST_MODE=real pnpm qa:main`，隔离 NAVO_HOME；受控入口 `NAVO_HOST_MODE=controlled pnpm qa:main`。用户真实模型验收授权已明确；本次不重复要求订阅路径通过，不关闭 BUG-036。
- [PR #125](https://github.com/likeWind221/Navo/pull/125) 代码 head `72a9bca` 的 [CI 44009549265](https://github.com/likeWind221/Navo/actions/runs/44009549265) 通过（verify 3m51s，包含类型、常规与崩溃恢复检查）；F5.4 状态更新为完成。随后仅文档收口，合并仍等待最终 head CI。

## 下一步

按当前 PR head CI 门禁收口；后续下一步为 F5.5，本次不开始实施。
