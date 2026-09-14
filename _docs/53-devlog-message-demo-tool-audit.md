# Host 工具列表排查记录

## 做了什么

用户发现 Agent 只自述 web_search/web_fetch。只读检查 Host 配置、插件注册、模型请求白名单和前端启动器，未修改后端或启用工具权限。原单 HTML 演示内容已合并至 [F4 实现汇总](52-devlog-f4-4-text-process.md)。

## 关键决策

前端 launch.ts 透传环境 → Host resolveKernelHostConfig 生成 toolNames → main.ts 按配置注册工具 → request.ts 用 schemas(input.toolNames) 构造模型请求。

当时启动环境未设置 NAVO_FILE_CWD，实际配置解析得到 web_search、web_fetch；对照配置指定项目目录后得到 web_search、web_fetch、read、shell、edit、write。工具列表由 Host 的启动配置与白名单决定，不是前端消息组件过滤。Node 领域工具不会仅因注册就自动暴露给 Host 回合。

## 坑与发现

配置在 Host 启动时读取，启用文件工具需指定 NAVO_FILE_CWD 并重启 Host，刷新界面不等于重载配置。该结论来自配置对照，并未读取运行进程内存；不能仅凭模型自述判定真实注册表，也不代表后续后端配置永远不变。

## 验证与下一步

当时现有 tests/host/tools.spec.ts 的四组 Mock 模型请求测试通过，覆盖搜索与文件配置组合的工具 schema，未真实执行搜索、文件写入或 Shell。本次前端收尾不改变后端配置。F4 已由用户确认验收成功，整体结论见 [F4 验收收尾](54-devlog-tool-result-rows.md)。
