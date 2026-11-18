# BUG-043：Electron 开发版把 Host 当作 Node 启动

日期：2026-11-17。状态：本机已修复并实际连通，待当前 head CI 与合并后关闭。

## 现象与复现

启动 `pnpm --dir frontend dev` 后桌面窗口可以出现，但界面显示“后端未连接”，Electron Main 日志为：

```text
[electron-main] Kernel Host did not become ready before the startup timeout
```

复现确认 `frontend/electron/host/launch.ts` 使用 `process.execPath` 和 `ELECTRON_RUN_AS_NODE=1` 启动 Host。Electron Main 中 `process.execPath` 指向 `electron.exe`，因此实际执行的是：

```text
electron.exe node_modules/tsx/dist/cli.mjs src/host/main.ts
```

该组合立即静默退出，不输出 ready。相同 Host 入口由普通 Node 运行时可以正常输出 `[kernel-host] ready`。

## 已证实事实与根因

已证实故障发生在 Kernel Host 启动阶段，而非 Renderer 连接或 RPC 握手：Host 子进程没有到达 ready 标记。根因是 Electron 可执行文件不能在该启动方式下替代独立 Node 来执行 `tsx` CLI。

## 修复内容

- 在 Electron 运行时默认使用独立 `node` 启动 `tsx`，不再使用 `process.execPath` 指向的 Electron 可执行文件。
- 支持 `NAVO_NODE_BIN` 显式覆盖 Node 路径，供 PATH 中没有合适 Node 的机器使用。
- 启动子进程前删除继承的 `ELECTRON_RUN_AS_NODE`，避免把 Electron 专用环境变量传给独立 Node。
- 启动配置单测覆盖独立 Node 选择、环境变量清理和显式 Node 路径覆盖。

## 验证结果与边界

- `pnpm --dir frontend exec vitest run electron/host/tests/launch.spec.ts`：4 项通过。
- `pnpm --dir frontend typecheck`：通过。
- `pnpm --dir frontend build`：通过。
- `pnpm --dir frontend dev`：出现 `[kernel-host] ready`，窗口加载已有项目，未再显示“后端未连接”。

本次未运行完整前端测试、未新建项目、未验证打包后的发行应用；当前分支尚未提交或触发 CI。界面加载已有项目只能证明开发版 Host 已连通，不替代用户对 F5.6b 人工验收、返工和 Main 复盘的检查。

## 后续

保持开发窗口运行供用户手动验收。F5.6b 收口时确认当前 head CI、合并和完整回归后再勾选 BUG-043；若目标机器没有可用 `node`，通过 `NAVO_NODE_BIN` 指向实际 Node 可执行文件。入口：[Bug 跟踪表](bug-plan.md)。
