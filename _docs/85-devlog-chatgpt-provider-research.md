# ChatGPT 订阅模型接入可行性调研

日期：2026-10-13。范围：只读检查 Navo、Pi 和官方文档；未登录账号、未读取既有令牌、未调用付费或订阅推理、未修改生产代码。此记录不是新 Step 的启动或完成确认。

## 做了什么

结论：存在官方公开的接入路径，值得验证。优先采用 **Sign in with ChatGPT 的开源客户端授权 + 公共 Responses API**，学习 Pi 的认证与协议适配分工；不优先移植旧的 Codex backend-api 线路，也不接管 Pi/Codex 已有登录文件。

官方目前允许符合条件的 Plus / Pro 用户授权开源应用使用订阅。商业或远程托管应用另有准入路径，部分私有客户端仍属选定范围。已通过 `gh repo view --json nameWithOwner,isPrivate,url` 确认 Navo 仓库当前公开；公开仓库本身不能证明账号、工作区、区域和此次请求一定获准。

### 官方路径与条件

1. 为本机生成并持久保存稳定的 `ext_agent_host_id`，可采用 `urn:uuid:<UUID>`。
2. 首次用 `dynamic_agent_client`、实际应用名 Navo、state、nonce 和 PKCE 发起系统浏览器授权；本机回调使用 `127.0.0.1`，先监听再打开浏览器。
3. 回调取得发行的 `client_id`，校验 state 并交换令牌。后续授权复用发行的 ID，不每次创建新注册。检查 ID token 的签名、issuer、audience、expiry、nonce，并检查实际授予的 `chatgpt.tokens.use.direct`。
4. 本地受保护存储账号注册与令牌，刷新时串行处理同一会话，并一起保存轮换后的 refresh token 和 access token；Renderer、项目记录与日志不持有令牌。
5. 使用同一账号 access token 请求 `GET https://api.openai.com/v1/models` 获取模型目录，再请求 `POST https://api.openai.com/v1/responses`。模型目录不是一次实际推理成功的替代证明。
6. 必须 `store:false`、`stream:true`；HTTP 每次带所需历史，不依赖 `previous_response_id`。只在收到成功终态后判为成功；流中也可能出现订阅额度错误。

这条路径使用订阅授权，不是给普通 API key 增加订阅余额，不提供 ChatGPT 网页历史访问。官方说明 Plus 的五小时用量在各应用间共享；Pro 不适用该五小时限制，但仍需尊重账号和应用的实际额度与访问策略。不能把没有 API key 解释为无限调用或永远零费用；credits 是否可用由用户设置决定。

来源：[官方 Quickstart](https://developers.openai.com/siwc/quickstart)、[开源客户端总览](https://developers.openai.com/siwc/token-sharing-open-source)、[登录与动态注册](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[账号、刷新与用量](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)。

### Pi 源码证据

只读 GitHub main 快照：`earendil-works/pi` commit `7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6`。以下链接固定到同一快照。

| 模块 | 实际机制 | Navo 借鉴点 |
|---|---|---|
| [ChatGPT OAuth](https://github.com/earendil-works/pi/blob/7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6/packages/ai/src/auth/oauth/openai-chatgpt.ts) | 动态注册、稳定 UUID host ID、PKCE/state、1455 回调、令牌交换、scope 检查、提前刷新、登录结束关闭连接 | 认证生命周期独立于推理；Navo 使用自己的应用名、注册与凭据 |
| [OpenAI Provider](https://github.com/earendil-works/pi/blob/7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6/packages/ai/src/providers/openai.ts) | 同一提供商声明 API key 与订阅 OAuth；OAuth 过滤不支持的 classifier 模型 | Provider 描述可用认证和模型；Adapter 负责网络协议 |
| [Responses 请求](https://github.com/earendil-works/pi/blob/7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6/packages/ai/src/api/openai-responses.ts) | 订阅线路省略 max_output_tokens、temperature 等字段，store:false，stream:true | 认证方式影响请求能力；不能把 Qwen 参数直接透传 |
| [Responses 转换与流处理](https://github.com/earendil-works/pi/blob/7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6/packages/ai/src/api/openai-responses-shared.ts) | 输入历史/工具结果转换、有序输出块、工具参数增量、终态检查；保留 reasoning item、encrypted_content、文本 phase 和工具 namespace | 流式展示之外，还需保留下一次请求所需的供应商信息 |
| [凭据存储](https://github.com/earendil-works/pi/blob/7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6/packages/coding-agent/src/core/auth-storage.ts) | 存储读改写串行化及跨进程锁 | 防止 refresh token 轮换竞态；不搬入 Pi 整套存储框架 |
| [旧 Codex Adapter](https://github.com/earendil-works/pi/blob/7d75a0e3eb273dff753d49c066ea29fbe7b3b6f6/packages/ai/src/api/openai-codex-responses.ts) | 默认 base URL 为 chatgpt.com/backend-api，独立于公共 Responses 线路 | 这是另一条认证/协议路径，不能与新官方订阅线路混用 |

## 关键决策与建议（待用户采纳）

2026-10-13 用户已确认采用新 ChatGPT 订阅接入路径。该选择确定认证与推理线路，尚未确认具体实施 Step；后续建议中的模块设计仍待收口。

后续用户明确要求建立公共协议层，具体范围与最新候选设计见 [86：公共模型协议层与 ChatGPT 订阅接入方案](86-devlog-model-protocol-design.md)。该方案已补查 Harness 官方源码，并补充 Navo 当前 UNLICENSED 的准入验证边界；以下初始调研的模块建议以 86 为准。

### 保留 Navo 自己的 Agent Runtime

现有 `src/llm/adapter.ts` 已提供 `stream(GenerateRequest): AsyncIterable<ModelEvent>`；`src/llm/service.ts` 按 provider 注册适配器并统一取消和失败。新增 Responses Adapter 可复用这一边界和现有模型→工具→模型循环，不必引入 Pi Agent Loop 或 Codex app-server。

Codex app-server 是官方可选集成，但拥有自己的线程、工具和回合生命周期。作为 Navo 的基础模型适配器会引入两套执行控制。若以后提供“调用外部 Coding Agent”的工具，则可另行评估。

### 最小职责与候选修改范围

| 职责 | 候选范围 | 原因 |
|---|---|---|
| 提供商配置与装配 | `src/host/config.ts`、`src/host/main.ts` | 当前 provider 固定 qwen，且直接构造 Qwen Adapter；需要按选择装配 |
| 认证与凭据生命周期 | `src/llm/` 下独立认证所有者，具体文件在实施设计确认 | 管理登录、取消、刷新、登出与受保护保存，不向 Agent 暴露 token |
| Responses 请求与流转换 | `src/llm/adapters/` 下独立 Adapter 与同名目录 | system 转 instructions/developer；工具 Schema/结果转换；终态、usage 与错误翻译 |
| 回传所需供应商信息 | `src/llm/types.ts`、`src/llm/accumulator.ts`、Session 消息投影职责 | 当前块只保留正文、reasoning 文本或工具 id/name/arguments，不支持 reasoning item 等回传信息 |
| 登录和模型选择 UI | 后续单独交给前端计划及共享契约步骤 | 前端展示连接状态、模型和额度失败；令牌留在可信进程 |

建议明确区分 provider（提供商）、auth（认证方式）、adapter（通信协议）与 model（模型）。同一 OpenAI Responses 协议可支持 API key 和订阅 OAuth，但两种认证的允许参数、模型和计费不同。不要根据令牌字符串是否以 sk- 开头来决定 Navo 的行为，应由已验证配置明确指定。

候选流程，仅说明未来接入方向，未实现：

```text
[NEW: browser OAuth] -> [NEW: protected credentials / serialized refresh]
                                      |
                                      v
[REUSE: Session history / tool schema] -> [NEW: Responses adapter]
                                               |
                                               v
[REUSE: LLMService / ModelEvent] <- [NEW: stream + terminal translation]
               |
               v
[REUSE: Agent Runtime / local tools] -> [REUSE: next model request]
```

### 需要按当前官方协议处理的差异

- 订阅预览拒绝 `max_output_tokens`、`temperature` 等字段。Navo 当前的 maxTokens 不能被宣称为该线路的远端输出硬限制；是否拒绝配置或明确忽略，实施前须确认。现有本地运行预算与取消仍可复用。
- 显式 system input item 被拒绝，需要映射为 instructions/developer，并保留原有系统提示和上下文更新顺序。
- 工具必须通过 namespace 分组或 additional_tools input 提供。固定 namespace 下把返回的工具名映射为 Navo 注册名，tool call 的 namespace/call_id 等回传关系须保持一致。现有 read/shell/edit/write、搜索、资源和 Roadmap 工具仍由 Navo 本地执行。
- 推理展示通常是供应商暴露的摘要，不等于完整思维链。Pi 保留 encrypted reasoning 与其他 item 信息以支持无服务端存储的多轮回传；Navo 的 reasoning 文本不能替代这些信息。是否完整保留及不同供应商之间如何投影，需真实工具闭环验证，不在调研中假定已正确。
- HTTP 成功或收到部分正文不代表回合成功；`response.failed`、`response.incomplete`、缺终态断流和用户取消须分别转换，残缺工具参数不得触发执行。
- 达到订阅/应用额度时返回明确失败与用量入口，不自动切换到 API key 或其他计费路径。
- 不支持的 hosted tools 不影响 Navo 自己执行的本地函数工具；不把 OpenAI 的 hosted file search、Code Interpreter、computer use 等当成已接入能力。

来源：[预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)、[错误与恢复](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)、[Codex app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)。

## 坑与发现

- Pi 当前源码也不是应原样照抄的规范：ChatGPT OAuth 每次登录重新动态注册，ID token 只检查存在、未完成官方所要求的身份验证；Responses 通用工具转换还输出平铺工具。Navo 应以官方当前文档为准，逐项验证，而不是根据“Pi 支持”推定每一处符合最新协议。
- 本地 `deepseek-harness/` 源码当前不存在；找到的 `D:/Software/Deepseek Harness` 是安装程序目录，不是源码。此次没有完成对应 Harness 源码对照。正式后端子 Step 设计前仍须按 AGENTS.md 补读相关源码；不能把旧设计记录当作本次源码验证。
- 用户具体订阅类型、模型权限、服务区域、OAuth 授权和实际推理均未验证。已确认的是文档与源码层面的可行路径，未确认用户账号已经可用。

## 下一步

建议先单独确认接入范围，再验证“独立授权→账号模型目录→一次纯文本→一次本地工具闭环→取消→重启后凭据刷新”。不先做全提供商管理平台、远端托管、自动计费切换或搬入整个 Pi。任何订阅推理验证开始前按仓库规则报告预计耗时与影响范围，等待用户明确授权。

本次仅新增调研记录并登记索引；不改后端/前端步骤状态，不提交、不推送、不合并。文档检查只核对索引引用与 diff 格式，不运行代码测试。
