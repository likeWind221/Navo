# F3.6 完整链路验收

## 做了什么

- 新增 `frontend/scripts/qa/f36.ts` 与 `qa:f3-6` 入口，在隐藏 BrowserWindow 中装配真实 Electron Preload、v2 Turn bridge、Command bridge 和 Mock Host。
- 验证 `/hello` 成功、未知命令、参数错误、命令与活动回合并行、回合取消、通知数量和状态收敛。
- 修正构建后 `out/main/index.js` 的 Host 根目录解析，使默认启动可以找到仓库级 `tsx` 和 Host 入口。

## 关键决策

- F3.6 先以 Mock Host 固定验证跨进程链路和 UI 状态，不伪造真实模型结果；真实模型和人工桌面观察单独保留为未完成边界。
- 构建输出位于 `frontend/out/main` 时，Host 根目录向上解析到仓库根；显式 `SKILLWORLD_REPO_ROOT` 仍优先使用。

## 坑与发现

- 直接启动构建后的主入口曾把根目录解析为 `frontend/out`，导致 `tsx` 缺失；回归测试覆盖该目录层级。
- 截图检查发现 JSX 中的 Unicode 转义曾被当作字面量显示，修正后系统提示标题恢复为中文，并加入脚本断言。
- 当前环境未提供 `LLM_API_KEY`，无法完成真实 Qwen/模型服务和人工视觉验收。

## 下一步

- 设置真实模型 Host 所需环境后，执行真实 Electron 回合、工具和命令验收；由用户确认视觉、滚动、输入法和取消体验后将 F3.6 更新为完成。

## 追加验收

- `SKILLWORLD_QA_REAL=true pnpm qa:f2-6` 已通过：真实 Host 返回助手内容，界面回到“发送消息”，无横向溢出。
- 已人工查看 `frontend/qa-output/f3-6-mock.png`：系统提示行、失败/成功颜色、挂起回合的部分正文和停止按钮均可见；截图可能早于最后一次 React 绘制，最终取消状态以结果快照为准。
- 本轮 Computer Use 会话只提供浏览器表面，没有可操作的原生 Electron 窗口；因此人工点击验收仍未完成，F3.6 保持 `🔄`。

## 收口确认

- 用户已确认 F3.6 当前体验没有问题，F3.6 标记为完成。
- F3 之后暂无已冻结的前端实施 Step，后续方向需根据产品优先级重新规划。
