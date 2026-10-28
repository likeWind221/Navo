# 184：F15.1 远程 MCP 工具发现

日期：2026-10-28。F15.1 实施分支；未连接外部真实 MCP 服务，使用本地 Streamable HTTP 服务做协议验收。

## 做了什么

- 接入官方 TypeScript SDK `@modelcontextprotocol/client` 2.4.0，使用 Streamable HTTP。
- 新增可信环境配置 `NAVO_MCP_SERVERS_JSON`，校验服务 ID、URL 和请求头；默认不连接任何外部服务。
- 新增 MCP 目录服务，通过 SDK 的 `listTools()` 聚合分页结果，支持显式刷新、目录版本和关闭清理。
- 使用 `mcp:<serverId>/<toolName>` 标识工具来源，并检测同一服务内重名。
- 使用 Navo 现有 Schema 校验器判断参数规则是否兼容；不支持的规则明确标记，不静默删减。
- 将目录服务接入 Host 的 Tool Plugin 生命周期；本 Step 不把远程工具注册为可调用工具。
- 固定使用 SDK 的 2025 legacy 协议协商，记录实际协商版本；协议版本不支持时返回独立状态。
- 连接超时 15 秒；多个服务并行发现，单个服务失败不阻塞其他服务。

## 关键决策

- 采用官方 SDK v2.4.0，不自行实现 MCP JSON-RPC / Streamable HTTP。
- 发现和权限执行分离；F15.2 再将已授权工具映射到 ToolService。
- 协议范围先固定在 SDK 的 legacy 2025 协商；只支持新版协议的服务器会得到明确的 `version-unsupported`，不静默降级。F15.3 若需要现代协议再单独评估。
- 单个服务不可用时保留错误状态并关闭其连接；其他服务继续发现，不阻止 Host 启动。刷新失败时该服务的工具从快照移除，避免把旧目录冒充为当前目录。
- 目录变化通过显式 `refresh()` 获取，不以服务端 `list_changed` 自动改写当前回合；F15.2 用 snapshot revision 划定活动调用边界。
- 凭据只存在于可信配置；快照不包含 URL、请求头或底层异常文本。

## 坑与发现

- `ClientOptions` 没有 `timeout` 字段。原实现把 `timeout` 放在构造函数第二参数，TypeScript 报错且运行时被忽略，静默退回 SDK 默认 60 秒；改为 `client.connect(transport, { timeout: 15_000 })`，本地静默服务器实测 15.0 秒返回。
- `exactOptionalPropertyTypes` 下 SDK 的 `description?: string | undefined` 不能赋给 `description?: string`，接口需显式包含 `undefined`。
- Cordis 插件内直接读取 `ctx.mcpDirectory` 会抛出 `cannot get property "mcpDirectory" without inject`；必须通过 `ctx.inject(["mcpDirectory"], ...)` 启动服务。原单元测试直接构造服务，绕过了插件装配，未发现该问题。
- 原锁文件是手工拼接的：`zod@4.3.6` 只有 snapshots 条目、没有 packages 条目，`pnpm install --frozen-lockfile` 直接失败。已用 pnpm 10.33.0 重新生成，解析为 `zod@4.6.7`；锁文件不得手工补条目。
- Navo Schema 子集不支持 MCP 的所有 JSON Schema 关键字，发现成功不代表可执行；F15.2/F15.3 前需要用真实工具目录确认可用比例。

## 验证与边界

- `pnpm install --frozen-lockfile` 通过。
- `pnpm typecheck` 通过。
- `pnpm test tests/tools/mcp`：4 个文件、19 项通过；覆盖默认关闭、非法配置、Schema 不兼容、重名、连接失败、刷新失败、关闭、协议版本不支持、插件装配、多服务隔离，以及真实 Streamable HTTP 的分页、认证头和协议版本。
- 全量 `pnpm test --maxWorkers=4`：187 个文件、1159 项全部通过。
- [PR #121](https://github.com/likeWind221/Navo/pull/121) 的当前 head CI `verify` 通过；收口前以 PR checks 的最新结果为准。
- 未连接真实 AppWorld 或第三方 MCP 服务；未实现工具执行、本地 stdio、OAuth、MCP Server 或 AppWorld 评测。

## 下一步

通过当前 PR head CI 后收口 F15.1；F15.2 处理工具授权、调用与结果映射，并用真实 AppWorld 工具目录检查 Schema 兼容覆盖面。
