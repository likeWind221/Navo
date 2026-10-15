# 19：桌面工具可用性排查（2026-09-14）

> 本记录原为 `backend-plan.md` 第 12 节“后端维护记录”，2026-10-15 文档整理时移入开发记录，内容未改写。属于既有能力维护，不推进计划 Step。

## 一、工具白名单修复

- 做了什么：按用户要求排查现有工具注册与桌面模型可见性，修复配置 Exa 后普通桌面回合仅能看到 `web_search` 的问题。修改 `src/host/config.ts`、`tests/host/turn.spec.ts`，新增 `tests/host/tools.spec.ts`。属于既有能力修复，不推进 Phase 9 Step。
- 关键决策：普通桌面回合显式开放 `web_fetch`；配置 Exa 时增加 `web_search`；配置 `NAVO_FILE_CWD` 时增加 `read`、`shell`、`edit`、`write`。保留 Node 专属工具的作用域，不将整个注册表直接暴露给普通会话。复用现有注册与回合链路，不修改前端或 RPC 契约。
- 坑与发现：Search 和 Fetch 默认均已注册，但原 Host 搜索白名单遗漏其他工具；未配置搜索时原先不传白名单，又会暴露缺少 Adapter 的搜索和 Node 专属工具。文件工具注册本身依赖显式工作目录配置。现有配置测试还发现 `boundedInteger` 漏返解析值，一并恢复 `return parsed`。
- 验证：Host 配置与新增工具测试共 13 项通过；四种 Search/File 配置组合检查真实应用注册表，并经过 v2 Handler 与 AgentRuntime 检查 Mock 模型实际收到的 Schema；`pnpm typecheck` 通过。未调用真实搜索/网络服务，未执行文件写入或 Shell，未验收正在运行的桌面实例。
- 下一步：启动桌面应用前按需设置 `NAVO_FILE_CWD` 为已有绝对目录并重启，复验模型工具调用。无新增待落实契约；交付回复提供配置、注册、模型筛选链路的代码导读。该维护记录不推进 Phase 9。

## 二、系统提示词补充排查

- 桌面 Host 当前系统提示词只有 `You are Navo, a concise and helpful AI agent.`。v1/v2 Handler 均将它传入 Runtime，Session 将其作为首条 system 消息，Qwen Adapter 保留该角色和内容；工具 Schema 独立传输，不由系统提示词决定可用工具集合。
- 内容缺口：没有明确工具执行与结果验证工作流，没有提供已配置文件工作目录，也没有说明搜索与全文获取、Fetch 长文落盘后继续读取之间的配合。工具描述已经提供部分局部规则，不能据此断言模型一定不会调用工具；真实行为仍需模型验收。
- 排查时 Node Profile 仍为 SkillWorld 学习节点身份；已在 F9.2 泛化为通用工作节点，普通桌面入口仍不调用该 Profile。
- 验证：`tests/session/messages.spec.ts` 四项通过，覆盖 system 消息前置且不写入历史 Surface；其余传递链路为源码检查，未进行真实模型实验。

## 三、文件工具默认启用修复

- 做了什么：修复未设置 NAVO_FILE_CWD 时桌面只暴露 Web 工具的问题。修改 `src/host/config.ts`、`tests/host/file-config.spec.ts`、`tests/host/turn.spec.ts`、`tests/host/tools.spec.ts`；属于既有能力维护，不推进计划 Step。
- 关键决策：Host 默认使用 process.cwd()，显式 NAVO_FILE_CWD 仍覆盖默认且空值继续报错；本地四工具始终加入模型名单，现有 main.ts 创建并校验文件环境后注册工具。Electron 现有启动目录为仓库根目录。工作目录是相对路径基准，不是文件沙箱。
- 坑与发现：此前只修复白名单，仍要求手动提供目录；缺省时注册和模型可见性同时缺失。测试现覆盖有无搜索配置、有无显式目录四种组合，并通过真实 Runtime 执行 read 读取 package.json，断言成功事件和结果回传模型；模型使用 Mock。
- 验证：相关 16 项测试与 pnpm typecheck 通过。未执行 Shell 或写文件，未验收真实模型和正在运行的 Electron。未修改前端、RPC、WebFetch 网络限制或其他进行中的领域改动。
- 下一步：重启 Electron 使 Host 重新读取配置；无新增待落实契约，完成回复交付配置与执行链路导读。
