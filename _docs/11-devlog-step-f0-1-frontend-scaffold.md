# Step F0.1 桌面前端骨架开发记录

## 做了什么

- 将内核计划迁移为 `_docs/backend-plan.md`，新增独立前端计划。
- 在 `frontend/` 建立 Electron main/preload、React renderer、严格 TypeScript 配置与基础界面。
- 为前端建立独立包清单和锁文件，避免与后端根包并发修改依赖文件。

## 关键决策

- 前后端采用目录级、计划级和依赖锁文件级隔离。
- Renderer 开启 `contextIsolation` 与 sandbox，关闭 `nodeIntegration`；只由 preload 暴露最小只读信息。
- Electron 与 React 源码统一采用 TypeScript + ESM；仅让构建工具把 sandboxed preload 输出为 CommonJS，以兼顾源码一致性与 Electron 沙箱兼容性。
- 当前不建立 IPC/RPC、状态管理和业务组件，待后端公开契约稳定后按功能切片接入。

## 坑与发现

- `_docs/index.md`、PRD 和 `CLAUDE.md` 仍是共享控制文件，不能由两个 Agent 并发写入，需串行协调。
- 前端不能直接导入根目录 `src/**`，否则会把进程、生命周期和领域实现耦合进 Renderer。
- Electron 二进制下载受当前网络镜像超时影响，未完成 GUI 启动验证；TypeScript 检查与三进程生产构建已经通过。

## 下一步

人工审查后进入 F1.1，先确定页面信息架构，再实现静态 Node 学习工作区。
