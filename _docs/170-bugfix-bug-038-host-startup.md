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
