# 170：BUG-038 前端 Mock Host 首次启动超时

日期：2026-10-27。状态：仅排查，未修复；后续对照通过，原因未确认，等待复现。

## 现象与复现

F5.4 独立工作树在明确 Node24 / System32 PATH 下执行完整前端测试，`KernelHostProcess > starts one Mock Host and routes a complete stream` 触及 5 秒启动预算，报 `Kernel Host did not become ready before the startup timeout`。其余 175 项通过，首次结果不能算完整通过。

## 已证实事实与根因假设

KernelHostProcess、该项测试和根 Mock Host 入口不在 F5.4 实际 diff 中。随后同一 master 的单文件对照 4 项通过，分支相同单文件 4 项通过，分支完整复验 30 文件 / 176 项通过（3.50 秒）。这些结果证明当前未持续复现，不证明根因已经是环境、冷启动或负载，也不证明启动时间永远稳定。

## 修复内容

仅排查，未修复。未改生产启动逻辑、启动预算、测试超时或新增重试。

## 验证结果与边界

证据在本会话 `f54/checks/frontend.log`（首次失败）、`master-process.log`、`branch-process.log`、`frontend-final.log`；Node24 两份前端类型检查及复验后的生产构建通过。后续通过不能覆盖首轮失败事实；本项不因 F5.4 离线或 CI 通过自动关闭。

## 后续

再次出现时保留启动进程 stderr、退出码、ready 标记与时间，确认是实际业务故障还是环境竞争后按 Bug 分支修复；修复应使同一场景稳定通过并保留当前 head CI。本项与 BUG-036 认证 HTTP 403 分开跟踪。入口：[Bug 计划](bug-plan.md)。

## 2026-11-17 F5.4 真实验收启动失败

首次真实 DeepSeek 桌面验收在既有 10 秒 Host 启动预算处失败，尚未进入 UI 任务。证据 `%TEMP%/navo-f54-deepseek-20261117-evidence/f5-4-real.json`，同目录保留失败截图。当时后端完整测试同时执行。随后独立零生成启动探针在约 0.7 秒收到 `host-already-running`，源码 `src/host/lock.ts` 证实 Host 锁以 OS 用户为边界，隔离 NAVO_HOME 不隔离 Host 锁。由此确认当前存在同用户 Host 竞争，但不能据此断定首次 10 秒超时同因；保持未修复，先等待完整测试退出后串行复验，不增加生产超时或自动重试。本次验收记录见 [190](190-devlog-f5-4-deepseek.md)。

同日后端完整测试退出后，原生产启动配置下串行真实 Electron 复验通过（Host 输出 ready，后续 DeepSeek 两项目场景 passed）。未修复生产代码、未调整启动时限；首次超时根因仍未充分确认，本项保持未关闭。
