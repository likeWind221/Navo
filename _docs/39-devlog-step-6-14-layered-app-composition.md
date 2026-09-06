# Step 6.14 分层应用组合接入开发记录

## 做了什么

- 新增 `ToolsPlugin`，在工具根内组合 ToolService、SearchService、可选 Search Adapter 和内置 `web_search`。
- 新增 `NodePlugin`，在 Node 领域根内组合 NodeStore、Node 内容工具和 NodeSession Service。
- 将 Session、LLM、Tools、Runtime、Node 作为 `SkillWorldApp` 的五个同层根模块，并让 `createApp()` 等待所有内部插件就绪后再返回。
- 为 AgentRuntime 声明 Session、LLM、Tools 依赖，并扩展集成测试验证五层组合、内置工具和显式工具白名单。

## 关键决策

- 插件归属按业务语义划分：Search 属于通用 Tools，Node 内容工具属于 Node，但二者统一注册到 ToolService。
- 工具注册与 Agent 暴露分离；NodeAgent 继续通过 per-turn `toolNames` 只选择 `web_search` 和两个 Node 内容工具。
- Search Adapter 与 NodeSession 模型路由都由可信应用配置注入，不读取环境变量，也不在领域插件中硬编码 Provider。

## 坑与发现

- 同步组合函数内未等待嵌套 `ctx.plugin()` 时，外层 `createApp()` 会早于 Node 内容工具完成而返回；根插件改为异步并等待子插件后，返回即代表完整就绪。
- Tools 内置能力会进入全局注册表，因此通用 Runtime 调用若只需要局部能力，也必须显式传入工具白名单。

## 下一步

进入 Step 6.15，从公开应用入口完成“开始学习 → 搜索 → 教材 → 练习题 → 对话修改”的端到端验收与阶段收口。
