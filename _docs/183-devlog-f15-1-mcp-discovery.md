# 183：F15.1 远程 MCP 工具发现

日期：2026-10-28。F15.1 实施分支；未调用真实 MCP 服务。

## 做了什么
- 接入官方 TypeScript SDK `@modelcontextprotocol/client` 2.4.0，使用 Streamable HTTP。
- 新增可信环境配置 `NAVO_MCP_SERVERS_JSON`，校验服务 ID、URL 和请求头；默认不连接任何外部服务。
- 新增 MCP 目录服务，通过 SDK 的 `listTools()` 聚合分页结果，支持显式刷新、目录版本和关闭清理。
- 使用 `mcp:<serverId>/<toolName>` 标识工具来源，并检测同一服务内重名。
- 使用 Navo 现有 Schema 校验器判断参数规则是否兼容；不支持的规则明确标记，不静默删减。
- 将目录服务接入 Host 的 Tool Plugin 生命周期；本 Step 不把远程工具注册为可调用工具。

## 关键决策
- 采用官方 SDK v2.4.0，不自行实现 MCP JSON-RPC / Streamable HTTP。
- 发现和权限执行分离；F15.2 再将已授权工具映射到 ToolService。
- 单个服务不可用时保留错误状态，不让远程故障直接阻止 Host 启动；对外状态不回显底层异常或凭据。
- SDK 自动聚合分页，最多 64 页；刷新使用 `cacheMode: "refresh"`。

## 坑与发现
- Navo Schema 子集不支持 MCP 的所有 JSON Schema 关键字，发现成功不代表可执行。
- URL 禁止内嵌凭据、查询串和片段；请求头只接受可信配置。
- 当前环境无法运行仓库本机命令，本地完整测试尚未执行。

## 验证与边界
- 新增配置校验与目录服务单元测试，覆盖默认关闭、非法配置、Schema 不兼容、重名、连接失败、刷新失败及连接关闭。
- 尚未执行 `pnpm typecheck` / `pnpm test`，也未连接真实 MCP 服务；需本地完整验证及 PR head CI。
- 当前没有 Renderer/RPC；未实现 MCP 工具执行、本地 stdio、OAuth、MCP Server 或 AppWorld 评测。

## 下一步
在本地运行完整类型检查与测试，修正本地或 CI 发现的问题；通过后收口 F15.1，再进入 F15.2 权限执行。
